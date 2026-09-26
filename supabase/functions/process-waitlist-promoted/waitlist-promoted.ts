export const WAITLIST_PROMOTED_CATALOG_CODE = "AUT-CAT-17";
export const WAITLIST_PROMOTED_TEMPLATE = "waitlist_promoted";
export const WAITLIST_PROMOTED_CONSUMER_KEY = "sf174.waitlist_promoted";

export interface WaitlistPromotedCondition {
  key: string;
  kind: "protected";
  applies: true;
  passed: boolean;
  reason_code: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface WaitlistPromotedVariableInput {
  studentName: string;
  discipline: string;
  startsAt: string;
  timeZone: string;
  locale?: string;
  coach: string | null;
  location: string | null;
  creditsRemaining: number | null;
}

export interface WaitlistPromotedVariables {
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

export function isValidWhatsAppRecipient(recipient: string | null | undefined) {
  return /^\+[1-9][0-9]{7,14}$/.test(recipient?.trim() ?? "");
}

export function buildWaitlistPromotedConditions(input: {
  source: string | null;
  waitlistEntryId: string | null;
  reservationStatus: string | null;
  sessionStatus: string | null;
  studentId: string | null;
  recipient: string | null;
  contextComplete: boolean;
}): WaitlistPromotedCondition[] {
  const sourceValid = input.source === "waitlist" && Boolean(input.waitlistEntryId);
  const reservationValid =
    input.reservationStatus === "reserved" &&
    input.sessionStatus === "scheduled" &&
    input.contextComplete;

  return [
    {
      key: "waitlist.promoted",
      kind: "protected",
      applies: true,
      passed: sourceValid,
      reason_code: sourceValid ? "waitlist_promotion_confirmed" : "waitlist_promotion_invalid",
      reason: sourceValid
        ? "La reserva proviene de una promoción efectiva de lista de espera."
        : "El evento no corresponde a una promoción válida de lista de espera.",
      evidence: {
        source: input.source,
        waitlist_entry_id: input.waitlistEntryId,
      },
    },
    {
      key: "reservation.valid",
      kind: "protected",
      applies: true,
      passed: reservationValid,
      reason_code: reservationValid ? "reservation_confirmed" : "reservation_not_confirmable",
      reason: reservationValid
        ? "La reserva promovida está confirmada y conserva contexto válido."
        : "La reserva promovida ya no está confirmada o su contexto está incompleto.",
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
        ? "La alumna promovida está identificada."
        : "No se pudo identificar a la alumna promovida.",
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

export function buildWaitlistPromotedVariables(
  input: WaitlistPromotedVariableInput,
): WaitlistPromotedVariables {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error("waitlist_promoted_invalid_start_time");
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

export function waitlistPromotedIdempotencyKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("waitlist_promoted_reservation_required");
  return `sf174:waitlist_promoted:${id}`;
}

export function waitlistPromotedCandidateKey(reservationId: string) {
  const id = reservationId.trim();
  if (!id) throw new Error("waitlist_promoted_reservation_required");
  return `waitlist_promoted:${id}`;
}
