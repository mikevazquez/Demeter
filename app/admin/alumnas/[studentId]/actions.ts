"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

export async function updateStudent(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email =
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase() || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!studentId || !firstName || !phone) {
    redirect(`/admin/alumnas/${studentId}?error=invalid`);
  }

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { error } = await supabase.rpc("admin_update_student", {
    p_student_id: studentId,
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
  });

  if (error) {
    const code = error.message.includes("phone_exists") ? "phone_exists" : "save";
    redirect(`/admin/alumnas/${studentId}?error=${code}`);
  }

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  redirect(`/admin/alumnas/${studentId}?saved=1`);
}

export async function setStudentLifecycle(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!studentId || !["active", "inactive", "archived"].includes(status)) {
    redirect(`/admin/alumnas/${studentId}?error=lifecycle`);
  }

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_ARCHIVE);
  const { error } = await supabase.rpc("admin_set_student_lifecycle", {
    p_student_id: studentId,
    p_status: status,
  });

  if (error) redirect(`/admin/alumnas/${studentId}?error=lifecycle`);

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  redirect(`/admin/alumnas/${studentId}?saved=1`);
}
