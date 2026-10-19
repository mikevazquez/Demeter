"use server";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { workshopUuid } from "@/src/lib/workshops/admin";

export interface WorkshopContinuationState {
  error: string | null;
  releasedCount?: number;
}
export async function recordWorkshopContinuation(
  _state: WorkshopContinuationState,
  data: FormData,
): Promise<WorkshopContinuationState> {
  const ctx = await getAdminContext("students.read");
  if (!ctx.can("sales.write") || !ctx.can("schedule.write"))
    return { error: "Necesitas permisos de ventas y reservas." };
  const purchaseId = String(data.get("purchase_id") ?? ""),
    requestId = String(data.get("request_id") ?? "");
  const reason = String(data.get("reason") ?? "").trim();
  if (
    ![purchaseId, requestId].every((id) => workshopUuid.test(id)) ||
    reason.length < 3 ||
    reason.length > 1000 ||
    data.get("withdraw_confirmed") !== "on"
  )
    return { error: "Confirma la decisión de la alumna y escribe el motivo." };
  const response = await (async () => {
    try {
      return await ctx.supabase.rpc("admin_record_workshop_continuation", {
        p_studio_id: ctx.studio.id,
        p_purchase_id: purchaseId,
        p_request_id: requestId,
        p_decision: "withdraw",
        p_reason: reason,
      });
    } catch {
      return { error: { message: "Result unverified" }, data: null };
    }
  })();
  if (
    response.error ||
    response.data?.purchase_id !== purchaseId ||
    !Number.isInteger(response.data?.released_count)
  )
    return { error: "No pudimos verificar la baja. Actualiza el historial antes de reintentar." };
  for (const path of ["/admin/alumnas", "/admin/hoy", "/admin/agenda", "/admin/actividades"])
    revalidatePath(path, "layout");
  return { error: null, releasedCount: response.data.released_count };
}
