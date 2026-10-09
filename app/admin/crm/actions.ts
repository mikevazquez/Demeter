"use server";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setAttendanceFromToday } from "../actions";

export async function prepareContactRecord(personId: string) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data: contact, error: readError } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("person_id", personId)
    .maybeSingle();
  if (readError || !contact)
    redirect(`/admin/crm/${encodeURIComponent(personId)}?error=contact_record`);
  const { data, error } = await supabase.rpc("assistant_ensure_trial_student", {
    target_studio_id: studio.id,
    target_crm_contact_id: contact.id,
  });
  if (error || !data?.ok)
    redirect(
      `/admin/crm/${personId}?error=${encodeURIComponent(data?.reason_code || "contact_record")}`,
    );
  revalidatePath("/admin/crm", "layout");
  redirect(`/admin/crm/${personId}?tab=profile&view=profile`);
}

export async function setCrmAttendance(personId: string, form: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("person_id", personId)
    .is("archived_at", null)
    .maybeSingle();
  const { data: reservation } = student
    ? await supabase
        .from("reservations")
        .select("id,session_id")
        .eq("studio_id", studio.id)
        .eq("student_id", student.id)
        .eq("id", String(form.get("reservation_id") || ""))
        .maybeSingle()
    : { data: null };
  if (!reservation) redirect(`/admin/crm/${encodeURIComponent(personId)}?error=attendance`);
  form.set("session_id", reservation.session_id);
  form.set("return_to", `/admin/crm/${personId}?tab=activity`);
  revalidatePath("/admin/crm", "layout");
  await setAttendanceFromToday(form);
}
export async function saveFollowup(
  _previous: { error?: string; saved?: boolean },
  form: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const personId = String(form.get("person_id") || "");
  const revision = Number(form.get("revision"));
  if (!/^[0-9a-f-]{36}$/i.test(personId) || !Number.isSafeInteger(revision) || revision < 0)
    return { error: "Contacto inválido." };
  const fields = [
    "prospect_stage",
    "qualification",
    "qualification_reason",
    "human_reason",
    "human_summary",
    "location",
    "interest",
    "notes",
    "next_action",
    "next_action_on",
  ];
  const data = Object.fromEntries(fields.map((k) => [k, String(form.get(k) || "").trim()]));
  if (data.qualification === "not_qualified" && !data.qualification_reason)
    return { error: "Indica por qué no es apta." };
  if (data.human_reason && !data.human_summary)
    return { error: "Agrega un resumen para atención humana." };
  const { error } = await supabase.rpc("admin_save_crm_followup", {
    p_studio_id: studio.id,
    p_person_id: personId,
    p_revision: revision,
    p_data: data,
  });
  if (error)
    return {
      error: error.message.includes("crm_revision_conflict")
        ? "La ficha cambió. Recarga antes de guardar."
        : error.message.includes("crm_incomplete_data")
          ? "Los datos incompletos deben conservar la etapa Espera de datos."
          : "No se pudo guardar el seguimiento. Revisa los datos e intenta nuevamente.",
    };
  revalidatePath("/admin/crm");
  revalidatePath(`/admin/crm/${personId}`);
  return { saved: true };
}

export async function saveInactivityDays(
  _previous: { error?: string; saved?: boolean },
  form: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const days = Number(form.get("inactivity_days"));
  if (!Number.isInteger(days) || days < 1 || days > 365)
    return { error: "Elige un plazo entre 1 y 365 días." };
  const { error } = await supabase.rpc("admin_set_crm_inactivity_days", {
    p_studio_id: studio.id,
    p_days: days,
  });
  if (error) return { error: "No se pudo guardar el plazo. Intenta otra vez." };
  revalidatePath("/admin/crm", "layout");
  return { saved: true };
}
