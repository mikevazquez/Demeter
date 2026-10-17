"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { workshopPurchaseError, workshopUuid } from "@/src/lib/workshops/admin";

export interface WorkshopTransferReviewState {
  error: string | null;
  result?: { holdId: string; state: "confirmed" | "rejected"; replayed: boolean; purchaseId?: string; saleId?: string };
}

/**
 * Administrative review only. The bank receipt upload itself MUST NOT call
 * this action or assert that money has been received.
 */
export async function reviewWorkshopTransfer(
  _previous: WorkshopTransferReviewState,
  data: FormData,
): Promise<WorkshopTransferReviewState> {
  const holdId = String(data.get("hold_id") ?? "");
  const decision = String(data.get("decision") ?? "");
  const reason = String(data.get("reason") ?? "").trim();
  if (!workshopUuid.test(holdId))
    return { error: "Selecciona un comprobante válido." };
  if (decision !== "approve" && decision !== "reject")
    return { error: "Selecciona aprobar o rechazar." };
  if (decision === "approve" && data.get("payment_received") !== "on")
    return { error: "Verifica el ingreso en el banco antes de aprobar la transferencia." };
  if (decision === "reject" && (reason.length < 1 || reason.length > 500))
    return { error: "Indica el motivo del rechazo (máximo 500 caracteres)." };

  const ctx = await getAdminContext("sales.write");
  if (!ctx.can("schedule.write"))
    return { error: "Tu cuenta necesita permisos de ventas y agenda." };

  const response = decision === "approve"
    ? await ctx.supabase.rpc("admin_confirm_workshop_provisional_hold", {
        p_studio_id: ctx.studio.id,
        p_hold_id: holdId,
        p_received: true,
      })
    : await ctx.supabase.rpc("admin_reject_workshop_provisional_hold", {
        p_studio_id: ctx.studio.id,
        p_hold_id: holdId,
        p_reason: reason,
      });
  if (response.error) {
    const message = response.error.message ?? "";
    if (message.includes("hold_expired") || message.includes("invalid_hold_transition"))
      return { error: "El apartado venció o ya fue procesado. Actualiza la lista." };
    if (message.includes("hold_not_found"))
      return { error: "Este apartado no está disponible en el estudio." };
    return { error: workshopPurchaseError(message) };
  }

  const result = response.data;
  if (!result || result.hold_id !== holdId ||
      result.state !== (decision === "approve" ? "confirmed" : "rejected"))
    return { error: "No fue posible verificar el resultado. Actualiza la lista antes de reintentar." };
  if (decision === "approve" && (!workshopUuid.test(String(result.purchase_id ?? "")) ||
      !workshopUuid.test(String(result.sale_id ?? ""))))
    return { error: "La respuesta no contiene una compra verificable. Revisa Ventas antes de reintentar." };

  revalidatePath("/admin/actividades/talleres");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/hoy");
  revalidatePath("/admin/ventas");
  if (decision === "approve") revalidatePath(`/admin/ventas/${result.sale_id}`);

  return {
    error: null,
    result: {
      holdId,
      state: result.state,
      replayed: result.replayed === true,
      ...(decision === "approve"
        ? { purchaseId: result.purchase_id as string, saleId: result.sale_id as string }
        : {}),
    },
  };
}
