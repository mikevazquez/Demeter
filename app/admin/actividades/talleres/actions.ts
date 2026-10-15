"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  workshopPurchaseError,
  workshopPurchaseInput,
  workshopUuid,
  type WorkshopPurchaseState,
} from "@/src/lib/workshops/admin";

export async function purchaseWorkshop(
  _state: WorkshopPurchaseState,
  data: FormData,
): Promise<WorkshopPurchaseState> {
  const ctx = await getAdminContext("sales.write");
  if (!ctx.can("schedule.write"))
    return { error: "Tu cuenta no tiene permiso para reservar fechas." };
  const input = workshopPurchaseInput(data);
  if (!input.ok) return { error: input.error };
  let response;
  try {
    response = await ctx.supabase.rpc("admin_purchase_workshop", {
      p_studio_id: ctx.studio.id,
      p_offer_id: input.offerId,
      p_student_id: input.studentId,
      p_session_ids: input.sessionIds,
      p_purchase_mode: input.mode,
      p_request_id: input.requestId,
      p_received_amount_minor: input.amountMinor,
      p_payment_method: input.method,
      p_reference: input.reference,
      p_received: true,
    });
  } catch {
    return { error: workshopPurchaseError("") };
  }
  if (response.error) return { error: workshopPurchaseError(response.error.message) };
  const receipt = response.data;
  if (
    !receipt ||
    !workshopUuid.test(receipt.purchase_id) ||
    !workshopUuid.test(receipt.sale_id) ||
    !Number.isSafeInteger(receipt.paid_minor) ||
    !Number.isSafeInteger(receipt.total_minor)
  ) {
    return { error: workshopPurchaseError("") };
  }
  for (const path of [
    "/admin/actividades/talleres",
    `/admin/actividades/talleres/${input.offerId}`,
    "/admin/agenda",
    "/admin/ventas",
    `/admin/ventas/${receipt.sale_id}`,
    "/student",
  ])
    revalidatePath(path);
  return {
    error: null,
    receipt: {
      purchaseId: receipt.purchase_id,
      saleId: receipt.sale_id,
      totalMinor: receipt.total_minor,
      paidMinor: receipt.paid_minor,
      replayed: receipt.replayed === true,
    },
  };
}
