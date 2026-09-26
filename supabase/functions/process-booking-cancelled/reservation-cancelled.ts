export const RESERVATION_CANCELLED_CATALOG_CODE = "AUT-CAT-02";
export const RESERVATION_CANCELLED_TEMPLATE = "reservation_cancelled";
export const RESERVATION_CANCELLED_CONSUMER_KEY = "sf174.reservation_cancelled";

export const CANCELLATION_STATUSES = [
  "cancelled_on_time",
  "cancelled_late",
  "cancelled_by_studio",
] as const;

export type CancellationStatus = (typeof CANCELLATION_STATUSES)[number];

export interface ReservationCancelledCondition {
  key: string;
  kind: "protected";
  applies: true;
  passed: boolean;
  reason_code: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface ReservationCancelledVariableInput {
  className: string;
  startsAt: string;
  timeZone: string;
  locale?: string;
  cancellationStatus: CancellationStatus;
  unlimited: boolean | null;
  hasRelease: boolean;
  hasConsume: boolean;
  creditsRemaining: number | null;
}

export interface ReservationCancelledVariables {
  clase: string;
  fecha: string;
  hora: string;
  tipo_cancelacion: string;
  credito_recuperado: boolean | null;
  creditos_restantes: number | null;
}

export function isCancellationStatus(value: unknown): value is CancellationStatus {
  return CANCELLATION_STATUSES.includes(value as CancellationStatus);
}

export function isValidWhatsAppRecipient(recipient: string | null | undefined) {
  return /^\+[1-9][0-9]{7,14}$/.test(recipient?.trim() ?? "");
}

export function buildReservationCancelledConditions(input: {
  reservationStatus: string | null;
  eventToStatus: string | null;
  studentId: string | null;
  recipient: string | null;
  contextComplete: boolean;
}): ReservationCancelledCondition[] {
  const finalized =
    isCancellationStatus(input.reservationStatus) &&
    input.eventToStatus === input.reservationStatus &&
    input.contextComplete;

  return [
    {
      key: "cancellation.finalized",
      kind: "protected",
      applies: true,
      passed: finalized,
      reason_code: finalized ? "cancellation_finalized" : "cancellation_not_finalized",
      reason: finalized
        ? "La cancelación quedó finalizada y conserva contexto válido."
        : "La cancelación no está finalizada o su contexto está incompleto.",
      evidence: {
        reservation_status: input.reservationStatus,
        event_to_status: input.eventToStatus,
        context_complete: input.contextComplete,
      },
    },
    {
      key: "student.identified",
      kind: "protected",
      applies: true,
      passed: Boolean(input.studentId),
      reason_code: input.studentId ? "student_identified" : "student_not_identified",
      reason: input.studentId
        ? "La alumna está identificada."
        : "No se pudo identificar a la alumna de la reserva.",
    },
    {
      key: "channel.available",
      kind: "protected",
      applies: true,
      passed: isValidWhatsAppRecipient(input.recipient),
      reason_code: isValidWhatsAppRecipient(input.recipient)
        ? "whatsapp_contact_valid"
        : "whatsapp_contact_invalid",
      reason: isValidWhatsAppRecipient(input.recipient)
        ? "El canal de WhatsApp tiene un destinatario válido."
        : "El teléfono no es un destinatario E.164 válido para WhatsApp.",
    },
  ];
}

function cancellationLabel(status: CancellationStatus) {
  switch (status) {
    case "cancelled_on_time":
      return "A tiempo";
    case "cancelled_late":
      return "Tardía";
    case "cancelled_by_studio":
      return "Por el estudio";
  }
}

export function buildReservationCancelledVariables(
  input: ReservationCancelledVariableInput,
): ReservationCancelledVariables {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error("reservation_cancelled_invalid_start_time");
  }

  const date = new Intl.DateTimeFormat(input.locale || "es-MX", {
    timeZone: input.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(startsAt);

  const time = new Intl.DateTimeFormat(input.locale || "es-MX", {
    timeZone: input.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startsAt);

  const creditRecovered =
    input.unlimited === true
      ? null
      : input.hasRelease && !input.hasConsume
        ? true
        : input.hasConsume
          ? false
          : null;

  return {
    clase: input.className.trim() || "Clase",
    fecha: date,
    hora: time,
    tipo_cancelacion: cancellationLabel(input.cancellationStatus),
    credito_recuperado: creditRecovered,
    creditos_restantes: input.unlimited === false ? input.creditsRemaining : null,
  };
}

export function reservationCancelledIdempotencyKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("reservation_cancelled_reservation_required");
  return `sf174:reservation_cancelled:${id}`;
}

export function reservationCancelledCandidateKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("reservation_cancelled_reservation_required");
  return `reservation_cancelled:${id}`;
}
