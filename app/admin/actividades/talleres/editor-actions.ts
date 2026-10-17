"use server";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { workshopUuid } from "@/src/lib/workshops/admin";
import {
  workshopDraftError,
  workshopEditorError,
  type WorkshopSaveState,
} from "@/src/lib/workshops/editor";

export async function saveWorkshop(
  _state: WorkshopSaveState,
  data: FormData,
): Promise<WorkshopSaveState> {
  const ctx = await getAdminContext("products.write");
  if (!ctx.can("schedule.write"))
    return { error: "Tu cuenta no tiene permiso para configurar las fechas." };
  const offerId = String(data.get("offer_id") ?? ""),
    requestId = String(data.get("request_id") ?? "");
  const revision = String(data.get("revision") ?? "");
  if (
    (offerId && !workshopUuid.test(offerId)) ||
    !workshopUuid.test(requestId) ||
    (offerId
      ? !/^\d+$/.test(revision) || Number(revision) < 1 || Number(revision) > 2_147_483_647
      : revision !== "")
  )
    return { error: "Reabre el formulario para revisar la solicitud." };
  let draft: unknown;
  try {
    draft = JSON.parse(String(data.get("payload") ?? ""));
  } catch {
    return { error: "Revisa los datos del taller." };
  }
  const error = workshopDraftError(draft, !!offerId);
  if (error) return { error };
  let response;
  try {
    response = await ctx.supabase.rpc("admin_save_workshop", {
      p_studio_id: ctx.studio.id,
      p_offer_id: offerId || null,
      p_request_id: requestId,
      p_expected_revision: offerId ? Number(revision) : null,
      p_draft: draft,
    });
  } catch {
    return { error: workshopEditorError("") };
  }
  if (response.error) return { error: workshopEditorError(response.error.message) };
  const saved = response.data;
  if (!saved || !workshopUuid.test(saved.offer_id) || !Number.isInteger(saved.revision))
    return { error: workshopEditorError("") };
  for (const path of [
    "/admin/actividades",
    "/admin/actividades/talleres",
    `/admin/actividades/talleres/${saved.offer_id}`,
    `/admin/actividades/talleres/${saved.offer_id}/editar`,
    "/admin/agenda",
  ])
    revalidatePath(path);
  return {
    error: null,
    saved: { offerId: saved.offer_id, revision: saved.revision, replayed: saved.replayed === true },
  };
}
