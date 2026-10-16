"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { receivedAmountMinor, workshopUuid } from "@/src/lib/workshops/admin";

export async function registerWorkshopAbono(data: FormData) {
  const saleId = String(data.get("sale_id") ?? "");
  const reservationId = String(data.get("reservation_id") ?? "");
  const sessionId = String(data.get("session_id") ?? "");
  const amount = receivedAmountMinor(String(data.get("payment_amount") ?? ""));
  const method = String(data.get("payment_method") ?? "");
  const reference = String(data.get("payment_reference") ?? "").trim();
  const back = `/admin/agenda/${sessionId}`;
  const fail = (code: string) => redirect(`${back}?error=${code}`);
  if (![saleId, reservationId, sessionId].every((id) => workshopUuid.test(id)) ||
      amount === null || !["efectivo", "transferencia", "tarjeta_manual"].includes(method) ||
      reference.length < 3 || reference.length > 200) fail("workshop_payment_invalid");

  const ctx = await getAdminContext(CAPABILITIES.SALES_WRITE);
  if (!ctx.can(CAPABILITIES.SCHEDULE_READ)) fail("workshop_payment_forbidden");
  const { data: link } = await ctx.supabase.from("workshop_purchase_sessions")
    .select("purchase_id,session_id").eq("reservation_id", reservationId).eq("session_id", sessionId).maybeSingle();
  if (!link) return fail("workshop_payment_not_linked");
  const { data: purchase } = await ctx.supabase.from("workshop_purchases")
    .select("id,sale_id,student_id,status").eq("id", link.purchase_id).eq("studio_id", ctx.studio.id).eq("sale_id", saleId).maybeSingle();
  if (!purchase || purchase.status !== "reserved") fail("workshop_payment_not_linked");
  const { data: sale } = await ctx.supabase.from("sales")
    .select("id,status,student_id").eq("id", saleId).eq("studio_id", ctx.studio.id).maybeSingle();
  if (!sale || sale.status !== "confirmed") fail("workshop_payment_not_linked");
  const { data: reservation } = await ctx.supabase.from("reservations")
    .select("id,student_id").eq("id", reservationId).eq("session_id", sessionId).eq("studio_id", ctx.studio.id).maybeSingle();
  if (!reservation || reservation.student_id !== purchase?.student_id || reservation.student_id !== sale?.student_id) fail("workshop_payment_not_linked");

  // The existing transactional RPC locks the sale and enforces the remaining balance.
  const { error } = await ctx.supabase.rpc("register_sale_payment", {
    target_sale_id: saleId,
    payment_amount_minor: amount,
    payment_method: method,
    payment_reference: reference,
    payment_notes: "Abono de taller desde Agenda",
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("workshop_agenda_abono_reference_unique") || message.includes("23505")) fail("workshop_payment_duplicate");
    fail(message.includes("payment_exceeds_balance") || message.includes("sale_already_paid") ? "workshop_payment_exceeds_balance" : "workshop_payment_failed");
  }
  revalidatePath(back);
  revalidatePath("/admin/ventas");
  revalidatePath(`/admin/ventas/${saleId}`);
  revalidatePath("/admin/hoy");
  redirect(`${back}?created=workshop-payment`);
}
