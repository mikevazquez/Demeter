"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function moneyToMinor(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const [whole, decimals = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function errorUrl(path: string, error: string) {
  return `${path}?error=${encodeURIComponent(error)}`;
}

export async function createManualSaleAction(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const productIds = formData
    .getAll("product_id")
    .map((value) => String(value))
    .filter(Boolean);
  const paymentMinor = moneyToMinor(String(formData.get("payment_amount") ?? ""));
  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  const paymentReference = String(formData.get("payment_reference") ?? "").trim();
  const paymentNotes = String(formData.get("payment_notes") ?? "").trim();

  if (!studentId || productIds.length === 0 || paymentMinor === null) {
    redirect(errorUrl("/admin/ventas/nueva", "sale_invalid"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { data, error } = await supabase.rpc("create_manual_sale", {
    target_student_id: studentId,
    target_product_ids: productIds,
    initial_payment_minor: paymentMinor,
    payment_method: paymentMinor > 0 ? paymentMethod || null : null,
    payment_reference: paymentReference || null,
    payment_notes: paymentNotes || null,
  });

  if (error) {
    redirect(errorUrl("/admin/ventas/nueva", error.message));
  }

  const result = (data ?? {}) as { sale_id?: string };
  if (!result.sale_id) {
    redirect(errorUrl("/admin/ventas/nueva", "sale_not_created"));
  }

  revalidatePath("/admin/ventas");
  revalidatePath("/admin/alumnas");
  redirect(`/admin/ventas/${result.sale_id}?created=sale`);
}

export async function registerSalePaymentAction(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const paymentMinor = moneyToMinor(String(formData.get("payment_amount") ?? ""));
  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  const paymentReference = String(formData.get("payment_reference") ?? "").trim();
  const paymentNotes = String(formData.get("payment_notes") ?? "").trim();

  if (!saleId || paymentMinor === null || paymentMinor <= 0 || !paymentMethod) {
    redirect(errorUrl(`/admin/ventas/${saleId}`, "payment_invalid"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { error } = await supabase.rpc("register_sale_payment", {
    target_sale_id: saleId,
    payment_amount_minor: paymentMinor,
    payment_method: paymentMethod,
    payment_reference: paymentReference || null,
    payment_notes: paymentNotes || null,
  });

  if (error) {
    redirect(errorUrl(`/admin/ventas/${saleId}`, error.message));
  }

  revalidatePath("/admin/ventas");
  revalidatePath(`/admin/ventas/${saleId}`);
  redirect(`/admin/ventas/${saleId}?created=payment`);
}
