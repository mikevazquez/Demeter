"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { supportRequestErrorCode } from "@/lib/platform/support-requests";

/** NEB-01-19 · La dueña pide ayuda a Nébora. */
export async function createSupportRequestAction(formData: FormData) {
  const subject = String(formData.get("subject") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const body = String(formData.get("body") ?? "").trim();
  if (subject.length < 3 || subject.length > 120) {
    redirect("/admin/mas/ayuda?error=support_subject_invalid");
  }
  if (body.length > 2000) redirect("/admin/mas/ayuda?error=support_body_too_long");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.rpc("studio_create_support_request", {
    p_studio: studio.id,
    p_subject: subject,
    p_body: body,
  });
  if (error) redirect(`/admin/mas/ayuda?error=${supportRequestErrorCode(error.message)}`);
  revalidatePath("/admin/mas/ayuda");
  redirect("/admin/mas/ayuda?enviada=1");
}
