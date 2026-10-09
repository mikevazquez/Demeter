"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function saveFirstClassPaymentLink(form: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const amount = Number(String(form.get("amount") ?? ""));
  const { error } = await supabase.rpc("admin_save_demi_first_class_payment_link", {
    p_studio: studio.id,
    p_template: String(form.get("class_template_id") ?? ""),
    p_url: String(form.get("checkout_url") ?? "").trim(),
    p_amount: Math.round(amount * 100),
    p_enabled: form.get("enabled") === "on",
  });
  if (error) redirect("/admin/integraciones/mercado-pago?link_error=invalid");
  revalidatePath("/admin/integraciones/mercado-pago");
  redirect("/admin/integraciones/mercado-pago?link_saved=1");
}
