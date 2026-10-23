"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { workshopUuid } from "@/src/lib/workshops/admin";
import { workshopPaymentReference } from "@/src/lib/workshops/payment-reference";

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

export interface WorkshopPaymentState {
  error: string | null;
  paidMinor?: number;
  balanceMinor?: number;
  nextRequestId?: string;
}

function moneyToMinor(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimals = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

const workshopPaymentErrorCopy: Record<string, string> = {
  payment_invalid: "Escribe un monto válido.",
  payment_method_required: "Selecciona un método de pago.",
  payment_reference_required: "Escribe la referencia bancaria de la transferencia.",
  payment_method_unavailable: "Ese método no está habilitado en el estudio.",
  idempotency_conflict: "La referencia ya se usó con otro importe o método. Revisa el historial.",
  payment_exceeds_balance: "El abono no puede ser mayor al saldo pendiente.",
  sale_already_paid: "Este taller ya está liquidado.",
  sale_not_open: "Esta venta ya no acepta pagos.",
  workshop_purchase_not_open: "Esta compra de taller ya no acepta pagos.",
  workshop_purchase_not_found: "No encontramos esta compra de taller.",
  forbidden: "No tienes permisos para registrar este pago.",
};

export async function registerWorkshopPayment(
  _state: WorkshopPaymentState,
  data: FormData,
): Promise<WorkshopPaymentState> {
  const fail = (error: string): WorkshopPaymentState => ({ ..._state, error });
  const ctx = await getAdminContext("students.read");
  if (!ctx.can("sales.write")) return fail("Necesitas permisos de ventas.");

  const purchaseId = String(data.get("purchase_id") ?? "");
  const studentId = String(data.get("student_id") ?? "");
  const paymentMinor = moneyToMinor(String(data.get("payment_amount") ?? ""));
  const paymentMethod = String(data.get("payment_method") ?? "").trim();
  const paymentReference = workshopPaymentReference(
    paymentMethod,
    String(data.get("payment_reference") ?? ""),
    String(data.get("payment_request_id") ?? ""),
  );
  const paymentNotes = String(data.get("payment_notes") ?? "").trim();

  if (
    !workshopUuid.test(purchaseId) ||
    !workshopUuid.test(studentId) ||
    paymentMinor === null ||
    paymentMinor <= 0 ||
    !["cash", "bank_transfer", "efectivo", "transferencia"].includes(paymentMethod) ||
    paymentReference === null ||
    data.get("payment_received") !== "on"
  ) {
    return fail(
      "Revisa el monto y método, la referencia bancaria si es transferencia y confirma el dinero recibido.",
    );
  }

  const response = await (async () => {
    try {
      return await ctx.supabase.rpc("admin_register_workshop_payment", {
        p_studio_id: ctx.studio.id,
        p_purchase_id: purchaseId,
        p_payment_amount_minor: paymentMinor,
        p_payment_method: paymentMethod,
        p_payment_reference: paymentReference || null,
        p_payment_notes: paymentNotes || null,
      });
    } catch {
      return { data: null, error: { message: "Result unverified" } };
    }
  })();

  if (response.error) {
    return fail(
      workshopPaymentErrorCopy[response.error.message] ??
        "No pudimos registrar el pago. Revisa el historial antes de reintentar.",
    );
  }

  const result = response.data as {
    purchase_id?: string;
    sale_id?: string;
    paid_minor?: number;
    balance_minor?: number;
  } | null;

  if (
    result?.purchase_id !== purchaseId ||
    !Number.isInteger(result?.paid_minor) ||
    !Number.isInteger(result?.balance_minor) ||
    (result?.paid_minor ?? -1) < 0 ||
    (result?.balance_minor ?? -1) < 0
  ) {
    return fail("No pudimos verificar el pago. Actualiza antes de reintentar.");
  }

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/alumnas");
  revalidatePath("/admin/ventas");
  if (workshopUuid.test(String(result.sale_id ?? "")))
    revalidatePath(`/admin/ventas/${result.sale_id}`);
  return {
    error: null,
    paidMinor: result.paid_minor,
    balanceMinor: result.balance_minor,
    nextRequestId: randomUUID(),
  };
}
