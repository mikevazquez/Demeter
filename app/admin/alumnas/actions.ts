"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

function errorRedirect(code: string): never {
  redirect(`/admin/alumnas?error=${encodeURIComponent(code)}`);
}

export async function createStudent(formData: FormData) {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const email = rawEmail || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!firstName) errorRedirect("first_name_required");
  if (!phone) errorRedirect("phone_invalid");

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { error } = await supabase.rpc("admin_create_student", {
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
  });

  if (error) {
    if (error.message.includes("phone_exists")) errorRedirect("phone_exists");
    if (error.message.includes("phone_invalid")) errorRedirect("phone_invalid");
    errorRedirect("student_create_failed");
  }

  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect("/admin/alumnas?created=student");
}

export async function setStudentLifecycle(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const nextStatus = String(formData.get("status") ?? "");

  if (!studentId || !["active", "inactive", "archived"].includes(nextStatus)) {
    errorRedirect("lifecycle_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_ARCHIVE);
  const { error } = await supabase.rpc("admin_set_student_lifecycle", {
    p_student_id: studentId,
    p_status: nextStatus,
  });

  if (error) errorRedirect("lifecycle_failed");

  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect(`/admin/alumnas?created=${encodeURIComponent(nextStatus)}`);
}
