"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

function errorRedirect(code: string): never {
  redirect(`/admin/alumnas?error=${encodeURIComponent(code)}`);
}

function existingStudentRedirect(studentId: string): never {
  redirect(`/admin/alumnas?duplicate=${encodeURIComponent(studentId)}#alta-rapida`);
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

  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);

  const { data: existingStudent } = await supabase
    .from("students")
    .select("id,lifecycle_status")
    .eq("studio_id", studio.id)
    .eq("phone", phone)
    .maybeSingle();

  if (existingStudent) {
    existingStudentRedirect(existingStudent.id);
  }

  const { data: studentId, error } = await supabase.rpc("admin_create_student", {
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
  });

  if (error) {
    if (error.message.includes("phone_exists")) {
      const { data: racedStudent } = await supabase
        .from("students")
        .select("id,lifecycle_status")
        .eq("studio_id", studio.id)
        .eq("phone", phone)
        .maybeSingle();

      if (racedStudent) {
        existingStudentRedirect(racedStudent.id);
      }

      errorRedirect("phone_exists");
    }
    if (error.message.includes("phone_invalid")) errorRedirect("phone_invalid");
    if (error.message.includes("plan_limit_exceeded")) {
      errorRedirect("plan_limit_active_students");
    }
    errorRedirect("student_create_failed");
  }

  if (typeof studentId !== "string" || !studentId) {
    errorRedirect("student_create_failed");
  }

  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect(`/admin/alumnas/${studentId}/alta`);
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

  if (error) {
    if (error.message.includes("plan_limit_exceeded")) {
      errorRedirect("plan_limit_active_students");
    }
    errorRedirect("lifecycle_failed");
  }

  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect(`/admin/alumnas?created=${encodeURIComponent(nextStatus)}`);
}
