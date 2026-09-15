"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

export async function createInstructor(formData: FormData) {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? normalizeMexicanPhone(rawPhone) : null;
  const email =
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;

  if (!firstName) redirect("/admin/instructores?error=first_name_required");
  if (rawPhone && !phone) redirect("/admin/instructores?error=phone_invalid");

  const { supabase } = await getAdminContext(CAPABILITIES.INSTRUCTORS_WRITE);
  const { data, error } = await supabase.rpc("admin_create_instructor", {
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
    p_bio: bio,
  });

  if (error || !data) redirect("/admin/instructores?error=create_failed");
  revalidatePath("/admin/instructores");
  redirect(`/admin/instructores/${data}?created=1`);
}

export async function setInstructorStatus(formData: FormData) {
  const instructorId = String(formData.get("instructor_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!instructorId || !["active", "inactive"].includes(status)) {
    redirect("/admin/instructores?error=status_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.INSTRUCTORS_WRITE);
  const { error } = await supabase.rpc("admin_set_instructor_status", {
    p_instructor_id: instructorId,
    p_status: status,
  });
  if (error) redirect(`/admin/instructores/${instructorId}?error=status`);

  revalidatePath("/admin/instructores");
  revalidatePath(`/admin/instructores/${instructorId}`);
  redirect(`/admin/instructores/${instructorId}?saved=status`);
}
