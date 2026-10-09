/** CRM contract from Demi configuration (read 2026-10-08).
 * Pure state projection: never sends messages, books classes or changes balances.
 * Action results must be verified by Studio Flow before emitting events here.
 */
export const personTypes = ["prospect", "trial", "student", "former_student"] as const;
export type PersonType = (typeof personTypes)[number];
export const stages = {
  prospect: [
    "answering_questions",
    "awaiting_receipt",
    "awaiting_participant_data",
    "not_booked",
    "not_qualified",
  ],
  trial: ["scheduled", "attended", "not_attended", "payment_rejected"],
  student: ["enrollment_current"],
  former_student: ["enrollment_expired"],
} as const;
export type Stage = (typeof stages)[PersonType][number];
export const typeLabels: Record<PersonType, string> = {
  prospect: "Prospecto",
  trial: "Prueba",
  student: "Alumna",
  former_student: "Exalumna",
};
export const stageLabels: Record<Stage, string> = {
  answering_questions: "Resolviendo dudas",
  awaiting_receipt: "Espera de comprobante",
  awaiting_participant_data: "Espera de datos",
  not_booked: "No agendó",
  not_qualified: "No clasifica",
  scheduled: "Agendada",
  attended: "Asistió",
  not_attended: "No asistió",
  payment_rejected: "Pago rechazado",
  enrollment_current: "Inscripción vigente",
  enrollment_expired: "Inscripción vencida",
};
export type PaymentState =
  "none" | "awaiting_receipt" | "under_review" | "validated" | "rejected" | "cash_due";
export type PackageState = "none" | "active" | "expired";
export type Qualification = "pending" | "qualified" | "not_qualified";
export type HumanReason =
  | "refund"
  | "policy_exception"
  | "complaint"
  | "sensitive_topic"
  | "requested"
  | "persistent_error";
export type JourneyEvent = { id: string; at: string } & (
  | { kind: "payment_requested" }
  | { kind: "receipt_received" }
  | {
      kind: "reservation_created";
      reservationId: string;
      receiptReceived: boolean;
      participantsComplete: boolean;
      capacityVerified: boolean;
    }
  | { kind: "attendance_recorded"; attended: boolean; reservationId: string }
  | { kind: "payment_rejected" }
  | { kind: "payment_validated" }
  | { kind: "enrollment_activated"; enrollmentId: string; paymentVerified: boolean }
  | { kind: "enrollment_expired"; enrollmentId: string; expiryVerified: boolean }
  | { kind: "package_changed"; status: PackageState }
  | { kind: "qualification_changed"; value: Qualification; reason?: string }
  | { kind: "followups_exhausted" }
  | { kind: "inbound_received" }
  | { kind: "human_requested"; reason: HumanReason; summary: string }
  | { kind: "human_resolved" }
);
export type CrmState = {
  personType: PersonType;
  stage: Stage;
  qualification: Qualification;
  qualificationReason: string | null;
  payment: PaymentState;
  package: PackageState;
  enrollmentId: string | null;
  reservationId: string | null;
  human: { reason: HumanReason; summary: string } | null;
  history: {
    event: JourneyEvent;
    before: PersonType;
    after: PersonType;
    stageBefore: Stage;
    stageAfter: Stage;
  }[];
};
export function newProspect(): CrmState {
  return {
    personType: "prospect",
    stage: "answering_questions",
    qualification: "pending",
    qualificationReason: null,
    payment: "none",
    package: "none",
    enrollmentId: null,
    reservationId: null,
    human: null,
    history: [],
  };
}
function requireState(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function assertValidState(state: CrmState) {
  requireState(
    (stages[state.personType] as readonly string[]).includes(state.stage),
    "Etapa incompatible con el tipo",
  );
  requireState(
    state.qualification !== "not_qualified" || !!state.qualificationReason?.trim(),
    "No clasifica requiere motivo",
  );
  requireState(
    state.stage !== "not_qualified" || state.qualification === "not_qualified",
    "No clasifica requiere calificación consistente",
  );
}
export function applyJourneyEvent(previous: CrmState, event: JourneyEvent): CrmState {
  assertValidState(previous);
  requireState(
    !!event.id.trim() && Number.isFinite(Date.parse(event.at)),
    "Evento sin identidad o fecha válida",
  );
  if (previous.history.some((h) => h.event.id === event.id)) return previous;
  const next: CrmState = { ...previous, history: [...previous.history] };
  switch (event.kind) {
    case "payment_requested":
      requireState(
        next.personType === "prospect" && !isOutreachPaused(next),
        "La solicitud de primera clase requiere prospecto en seguimiento",
      );
      next.payment = "awaiting_receipt";
      next.stage = "awaiting_receipt";
      break;
    case "receipt_received":
      requireState(
        next.personType === "prospect" ||
          next.personType === "trial" ||
          next.personType === "student" ||
          next.personType === "former_student",
        "Tipo desconocido",
      );
      next.payment = "under_review";
      if (next.personType === "prospect" && next.qualification !== "not_qualified")
        next.stage = "awaiting_participant_data";
      // Rejected trial stays Trial until a verified reservation result is received.
      break;
    case "reservation_created":
      requireState(
        next.personType === "prospect" || next.personType === "trial",
        "Primera clase requiere Prospecto o Prueba",
      );
      requireState(
        next.qualification !== "not_qualified",
        "Reabrir la calificación antes de reservar",
      );
      requireState(
        event.receiptReceived &&
          event.participantsComplete &&
          event.capacityVerified &&
          !!event.reservationId.trim(),
        "Reserva no verificada: faltan comprobante, datos o cupo",
      );
      requireState(
        !next.reservationId ||
          next.reservationId === event.reservationId ||
          next.stage === "not_attended" ||
          next.stage === "payment_rejected",
        "Ya existe una primera reserva vigente",
      );
      requireState(
        next.stage !== "attended",
        "Tras asistir debe activar inscripción antes de reservar nuevamente",
      );
      next.personType = "trial";
      next.stage = "scheduled";
      next.reservationId = event.reservationId;
      next.payment = "under_review";
      break;
    case "attendance_recorded":
      requireState(
        next.personType === "trial" &&
          next.stage === "scheduled" &&
          next.reservationId === event.reservationId,
        "La asistencia no corresponde a una prueba agendada",
      );
      next.stage = event.attended ? "attended" : "not_attended";
      break;
    case "payment_rejected":
      requireState(next.payment === "under_review", "Solo se rechaza un pago en revisión");
      next.payment = "rejected";
      if (next.personType === "trial") next.stage = "payment_rejected";
      break;
    case "payment_validated":
      requireState(next.payment === "under_review", "Solo se valida un pago en revisión");
      next.payment = "validated";
      break;
    case "enrollment_activated":
      requireState(
        event.paymentVerified && !!event.enrollmentId.trim(),
        "Inscripción sin pago verificado",
      );
      next.enrollmentId = event.enrollmentId;
      next.personType = "student";
      next.stage = "enrollment_current";
      next.qualification = "qualified";
      next.qualificationReason = null;
      break;
    case "enrollment_expired":
      requireState(
        next.personType === "student" &&
          next.enrollmentId === event.enrollmentId &&
          event.expiryVerified,
        "Vencimiento de inscripción no verificado",
      );
      next.personType = "former_student";
      next.stage = "enrollment_expired";
      break;
    case "package_changed":
      next.package = event.status;
      break;
    case "qualification_changed":
      requireState(
        event.value !== "not_qualified" || !!event.reason?.trim(),
        "No clasifica requiere motivo",
      );
      next.qualification = event.value;
      next.qualificationReason = event.value === "not_qualified" ? event.reason!.trim() : null;
      if (next.personType === "prospect") {
        if (event.value === "not_qualified") next.stage = "not_qualified";
        else if (next.stage === "not_qualified") next.stage = "answering_questions";
      }
      break;
    case "followups_exhausted":
      requireState(
        next.personType === "prospect" &&
          ["answering_questions", "awaiting_receipt"].includes(next.stage),
        "Los datos incompletos conservan su etapa; No agendó no aplica aquí",
      );
      next.stage = "not_booked";
      break;
    case "inbound_received":
      if (next.personType === "prospect" && ["not_booked", "not_qualified"].includes(next.stage)) {
        next.stage = "answering_questions";
        if (next.qualification === "not_qualified") {
          next.qualification = "pending";
          next.qualificationReason = null;
        }
      }
      break;
    case "human_requested":
      requireState(!!event.summary.trim(), "Atención humana requiere resumen");
      next.human = { reason: event.reason, summary: event.summary };
      break;
    case "human_resolved":
      next.human = null;
      break;
  }
  assertValidState(next);
  next.history.push({
    event,
    before: previous.personType,
    after: next.personType,
    stageBefore: previous.stage,
    stageAfter: next.stage,
  });
  return next;
}
export function isOutreachPaused(state: CrmState) {
  return !!state.human || state.qualification === "not_qualified" || state.stage === "not_booked";
}
export function nextAction(state: CrmState): string {
  if (state.human) return "Atención humana";
  if (isOutreachPaused(state)) return "Seguimiento pausado";
  return {
    answering_questions: "Resolver dudas y elegir clase",
    awaiting_receipt: "Esperar comprobante",
    awaiting_participant_data: "Completar datos de participantes",
    not_booked: "Esperar nuevo contacto",
    not_qualified: "Esperar nuevo contacto",
    scheduled: "Confirmar asistencia",
    attended: "Invitar a pagar inscripción",
    not_attended: "Solicitar nuevo pago para reagendar",
    payment_rejected: "Solicitar comprobante correcto",
    enrollment_current: state.package === "active" ? "Gestionar clases" : "Renovar paquete",
    enrollment_expired: "Renovar inscripción",
  }[state.stage];
}
