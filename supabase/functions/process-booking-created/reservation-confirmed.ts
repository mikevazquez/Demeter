export const RESERVATION_CONFIRMED_CATALOG_CODE = "AUT-CAT-01";
export const RESERVATION_CONFIRMED_TEMPLATE = "reservation_confirmed";
export const RESERVATION_CONFIRMED_CONSUMER_KEY = "sf175.reservation_confirmed";

export interface ReservationConfirmedCondition {
  key: string;
  kind: "protected";
  applies: true;
  passed: boolean;
  reason_code: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface ReservationConfirmedVariableInput {
  studentName: string;
  discipline: string;
  startsAt: string;
  timeZone: string;
  locale?: string;
  coach: string | null;
  location: string | null;
  creditsRemaining: number | null;
}

export interface ReservationConfirmedVariables {
  nombre: string;
  disciplina: string;
  fecha: string;
  hora: string;
  coach: string | null;
  ubicacion: string | null;
  creditos_restantes: number | null;
}

export interface MessagingProviderInput {
  recipient: string;
  template: string;
  variables: Record<string, unknown>;
  executionId: string;
  metadata: Record<string, unknown>;
}

export interface MessagingProviderAcceptedResult {
  status: "accepted";
  providerReference?: string;
  responseSnapshot?: Record<string, unknown>;
}

export interface MessagingProviderErrorResult {
  status: "error";
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  responseSnapshot?: Record<string, unknown>;
}

export type MessagingProviderResult =
  MessagingProviderAcceptedResult | MessagingProviderErrorResult;

export interface MessagingProvider {
  readonly key: string;
  send(input: MessagingProviderInput): Promise<MessagingProviderResult>;
}

export class MockMessagingProvider implements MessagingProvider {
  readonly key = "mock";

  private readonly recordedDeliveries: MessagingProviderInput[] = [];

  get deliveries(): readonly MessagingProviderInput[] {
    return this.recordedDeliveries;
  }

  async send(input: MessagingProviderInput): Promise<MessagingProviderResult> {
    const deliveryNumber = this.recordedDeliveries.length + 1;
    this.recordedDeliveries.push({
      ...input,
      variables: { ...input.variables },
      metadata: { ...input.metadata },
    });

    return {
      status: "accepted",
      providerReference: `mock:${input.executionId}:${deliveryNumber}`,
      responseSnapshot: {
        mock: true,
        delivery_number: deliveryNumber,
      },
    };
  }
}

export function isValidWhatsAppRecipient(recipient: string | null | undefined) {
  return /^\+[1-9][0-9]{7,14}$/.test(recipient?.trim() ?? "");
}

export function buildReservationConfirmedConditions(input: {
  reservationStatus: string | null;
  sessionStatus: string | null;
  studentId: string | null;
  recipient: string | null;
  contextComplete: boolean;
}): ReservationConfirmedCondition[] {
  const reservationValid =
    input.reservationStatus === "reserved" &&
    input.sessionStatus === "scheduled" &&
    input.contextComplete;

  return [
    {
      key: "reservation.valid",
      kind: "protected",
      applies: true,
      passed: reservationValid,
      reason_code: reservationValid ? "reservation_confirmed" : "reservation_not_confirmable",
      reason: reservationValid
        ? "La reserva está confirmada y conserva contexto válido."
        : "La reserva ya no está confirmada o su contexto está incompleto.",
      evidence: {
        reservation_status: input.reservationStatus,
        session_status: input.sessionStatus,
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

export function buildReservationConfirmedVariables(
  input: ReservationConfirmedVariableInput,
): ReservationConfirmedVariables {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error("reservation_confirmed_invalid_start_time");
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

  return {
    nombre: input.studentName.trim() || "Alumna",
    disciplina: input.discipline.trim(),
    fecha: date,
    hora: time,
    coach: input.coach?.trim() || null,
    ubicacion: input.location?.trim() || null,
    creditos_restantes: input.creditsRemaining,
  };
}

export function reservationConfirmedIdempotencyKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("reservation_confirmed_reservation_required");
  return `sf175:reservation:${id}`;
}

export function reservationConfirmedCandidateKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("reservation_confirmed_reservation_required");
  return `reservation:${id}`;
}
