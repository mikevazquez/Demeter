"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
export async function saveKioskConfiguration(form: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.rpc("admin_save_kiosk_configuration", {
    target_studio_id: studio.id,
    p_pin: String(form.get("pin") ?? ""),
    p_message: String(form.get("message") ?? "").trim(),
  });
  if (error) redirect("/admin/configuracion/kiosco?error=save");
  revalidatePath("/admin/kiosco");
  redirect("/admin/configuracion/kiosco?saved=1");
}
