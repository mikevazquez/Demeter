import { workshopPaymentReference } from "./payment-reference";

export interface WorkshopSummary {
  id: string;
  title: string;
  fullPriceMinor: number;
  sessionCount: number;
}

export interface WorkshopAdminContext {
  offer: {
    id: string;
    revision: number;
    title: string;
    fullPriceMinor: number;
    allowIndividualSessions: boolean;
    requiresEnrollment: boolean;
    depositMode: "full" | "fixed" | "percent";
    depositValue: number | null;
    dueAt: string | null;
    overdueMode: "keep_and_notify" | "release_after_grace";
    graceMinutes: number;
  };
  sessions: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    priceMinor: number | null;
    capacityRemaining: number;
  }[];
  students: { id: string; name: string }[];
  paymentMethods: ("cash" | "bank_transfer")[];
}

export interface WorkshopPurchaseState {
  error: string | null;
  receipt?: {
    purchaseId: string;
    saleId: string;
    paidMinor: number;
    totalMinor: number;
    replayed: boolean;
  };
}

export const workshopUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Convert decimal input to cents without floating-point rounding or accepting extra decimals. */
export function receivedAmountMinor(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 2_147_483_647 ? minor : null;
}

export function workshopPurchaseInput(data: FormData) {
  const offerId = String(data.get("offer_id") ?? "");
  const studentId = String(data.get("student_id") ?? "");
  const requestId = String(data.get("request_id") ?? "");
  const mode = String(data.get("purchase_mode") ?? "");
  const sessionIds = data.getAll("session_ids").map(String);
  const amountMinor = receivedAmountMinor(String(data.get("received_amount") ?? ""));
  const method = String(data.get("payment_method") ?? "");
  const reference = workshopPaymentReference(
    method,
    String(data.get("reference") ?? ""),
    requestId,
    1,
  );
  const revisionText = String(data.get("offer_revision") ?? "");
  if (
    !/^\d+$/.test(revisionText) ||
    Number(revisionText) < 1 ||
    Number(revisionText) > 2_147_483_647
  )
    return { ok: false as const, error: "Actualiza el taller antes de registrar la compra." };
  if (![offerId, studentId, requestId].every((id) => workshopUuid.test(id)))
    return { ok: false as const, error: "Elige el taller y la alumna antes de continuar." };
  if (
    !["full", "sessions"].includes(mode) ||
    sessionIds.length < 1 ||
    sessionIds.length > 100 ||
    !sessionIds.every((id) => workshopUuid.test(id)) ||
    new Set(sessionIds).size !== sessionIds.length
  )
    return { ok: false as const, error: "Revisa las fechas seleccionadas." };
  if (amountMinor == null)
    return { ok: false as const, error: "Escribe un importe válido, con hasta dos decimales." };
  if (!["cash", "bank_transfer"].includes(method) || reference === null)
    return { ok: false as const, error: "Revisa el método y la referencia del pago." };
  if (data.get("payment_received") !== "on")
    return { ok: false as const, error: "Confirma que ya recibiste y verificaste el pago." };
  return {
    ok: true as const,
    offerId,
    studentId,
    requestId,
    mode,
    sessionIds,
    amountMinor,
    method,
    reference,
    revision: Number(revisionText),
  };
}

export function workshopPurchaseError(message: string) {
  const errors: [string, string][] = [
    [
      "workshop_revision_conflict",
      "El taller cambió. Actualiza la página y revisa el precio antes de registrar el pago.",
    ],
    [
      "idempotency_conflict",
      "Esta solicitud ya se usó con otros datos. Revisa la venta antes de intentar otra compra.",
    ],
    [
      "historical_payment_conflict",
      "La referencia ya pertenece a un pago registrado. Revisa la venta original.",
    ],
    [
      "payment_event_conflict",
      "La referencia ya pertenece a un pago registrado. Revisa la venta original.",
    ],
    ["session_full", "Una fecha se quedó sin cupo. No se registraron el pago ni las reservas."],
    ["session_unavailable", "Una fecha ya no está disponible. No se registró la compra."],
    ["student_already_reserved", "La alumna ya tiene una reserva en una de las fechas elegidas."],
    [
      "booking_blocked",
      "La alumna tiene documentos o restricciones de reserva pendientes. Revísalos antes de continuar.",
    ],
    ["enrollment", "Revisa la inscripción vigente de la alumna antes de reservar este taller."],
    ["student_not_operable", "La alumna no está disponible para nuevas reservas en este estudio."],
    ["insufficient_deposit", "El importe recibido no cubre el anticipo requerido."],
    ["payment_exceeds_total", "El importe recibido supera el precio de la compra."],
    [
      "balance_due_date_required",
      "El taller necesita una fecha de vencimiento para aceptar anticipos.",
    ],
    ["payment_method_unavailable", "Este método de pago ya no está habilitado en el estudio."],
    [
      "authorized_price_changed",
      "El precio cambió. Actualiza el taller y revisa el importe recibido.",
    ],
    ["forbidden", "Tu cuenta no tiene permiso para registrar esta compra."],
    ["payment_not_verified", "Confirma que ya recibiste y verificaste el pago."],
  ];
  return (
    errors.find(([code]) => message.includes(code))?.[1] ??
    "No pudimos completar la compra. Revisa las ventas antes de reintentar y conserva la misma referencia de pago."
  );
}
