"use server";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { revalidatePath } from "next/cache";
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
