"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeDate(value: FormDataEntryValue | null) {
  const date = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export async function saveHolidayOperation(formData: FormData) {
  const date = safeDate(formData.get("holiday_date"));
  const mode = String(formData.get("operation_mode") ?? "");
  const message = String(formData.get("student_message") ?? "").trim();
  const keepSessionIds = formData
    .getAll("keep_session_id")
    .map(String)
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));

  if (!date || !["normal", "closed", "special"].includes(mode)) {
    redirect("/admin/agenda?holiday=invalid");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_configure_holiday", {
    target_studio_id: studio.id,
    target_date: date,
    p_operation_mode: mode,
    p_student_message: message || null,
    p_keep_session_ids: keepSessionIds,
  });

  if (error) {
    const code = String(error.message ?? "").includes("official_holiday_not_found")
      ? "not-found"
      : "save-error";
    redirect(`/admin/agenda?date=${date}&holiday=${code}`);
  }

  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");
  redirect(`/admin/agenda?date=${date}&holiday=saved`);
}
