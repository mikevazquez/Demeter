"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { receivedAmountMinor, workshopUuid } from "@/src/lib/workshops/admin";
import { workshopPaymentReference } from "@/src/lib/workshops/payment-reference";

export async function registerWorkshopAbono(data: FormData) {
  const saleId = String(data.get("sale_id") ?? "");
  const reservationId = String(data.get("reservation_id") ?? "");
  const sessionId = String(data.get("session_id") ?? "");
  const amount = receivedAmountMinor(String(data.get("payment_amount") ?? ""));
  const method = String(data.get("payment_method") ?? "");
  const requestId = String(data.get("payment_request_id") ?? "");
  const reference = workshopPaymentReference(
    method,
    String(data.get("payment_reference") ?? ""),
    requestId,
  );
  const requestedBack = String(data.get("return_to") ?? "");
  const back = /^\/admin(?:\?date=\d{4}-\d{2}-\d{2})?(?:#session-[0-9a-f-]{36})?$/.test(
    requestedBack,
  )
    ? requestedBack
    : "/admin";
  const fail = (code: string) => {
    const destination = new URL(back, "https://local.invalid");
    destination.searchParams.set("error", code);
    if (method === "cash" && workshopUuid.test(requestId) && workshopUuid.test(saleId)) {
      destination.searchParams.set("workshop_payment_request", requestId);
      destination.searchParams.set("workshop_payment_sale", saleId);
    }
    return redirect(destination.pathname + destination.search + destination.hash);
  };
  if (
    ![saleId, reservationId, sessionId].every((id) => workshopUuid.test(id)) ||
    amount === null ||
    !["cash", "bank_transfer"].includes(method) ||
    reference === null
  )
    fail("workshop_payment_invalid");

  const ctx = await getAdminContext(CAPABILITIES.SALES_WRITE);
  if (!ctx.can(CAPABILITIES.SCHEDULE_READ) || !ctx.can(CAPABILITIES.STUDENTS_READ))
    fail("workshop_payment_forbidden");
  // The server derives purchase/student/tenant links and replays the same reference atomically.
  const { data: result, error } = await (async () => {
    try {
      return await ctx.supabase.rpc("admin_register_workshop_installment", {
        p_studio_id: ctx.studio.id,
        p_sale_id: saleId,
        p_reservation_id: reservationId,
        p_session_id: sessionId,
        p_amount_minor: amount,
        p_method: method,
        p_reference: reference,
      });
    } catch {
      return { data: null, error: { message: "Result unverified" } };
    }
  })();
  if (error) {
    const message = error.message ?? "";
    if (message.includes("workshop_agenda_abono_reference_unique") || message.includes("23505"))
      fail("workshop_payment_duplicate");
    fail(
      message.includes("payment_exceeds_balance") || message.includes("sale_already_paid")
        ? "workshop_payment_exceeds_balance"
        : "workshop_payment_failed",
    );
  }
  if (result?.ok !== true || result.sale_id !== saleId) fail("workshop_payment_failed");
  revalidatePath("/admin");
  revalidatePath("/admin/ventas");
  revalidatePath(`/admin/ventas/${saleId}`);
  revalidatePath("/admin/hoy");
  const destination = new URL(back, "https://local.invalid");
  destination.searchParams.set("created", "workshop-payment");
  redirect(destination.pathname + destination.search + destination.hash);
}
