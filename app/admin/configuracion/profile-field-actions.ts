"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
export async function addProfileFieldAction(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("field_type") ?? "short_text");
  const options = String(formData.get("options") ?? "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
  const { error } = await supabase.rpc("admin_upsert_profile_field_definition", {
    p_studio_id: studio.id,
    p_label: label,
    p_field_type: type,
    p_options: options.length ? options : null,
  });
  if (error) redirect("/admin/configuracion?error=profile_field#campos");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/alumnas");
  redirect("/admin/configuracion?saved=profile_field#campos");
}
export async function deactivateProfileFieldAction(formData: FormData) {
  const { supabase } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.rpc("admin_deactivate_profile_field_definition", {
    p_definition_id: String(formData.get("definition_id") ?? ""),
  });
  if (error) redirect("/admin/configuracion?error=profile_field#campos");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/alumnas");
  redirect("/admin/configuracion?saved=profile_field_removed#campos");
}
