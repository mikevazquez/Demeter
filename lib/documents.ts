export type DocumentStatus = "draft" | "scheduled" | "active" | "superseded" | "retired";
export type DocumentResponseMode = "accept_required" | "decision_optional" | "informational";
export type DocumentAcceptanceParty =
  "student" | "guardian_if_minor" | "student_and_guardian" | "guardian_only";
export type DocumentAudience = "all" | "adults" | "minors" | "activity" | "event" | "student";
export type DocumentEnforcement =
  "global_booking" | "activity_booking" | "event_registration" | "none";

export type DocumentCenterItem = {
  document_id: string;
  version_id: string;
  name: string;
  document_type: string;
  description: string | null;
  version_number: number;
  response_mode: DocumentResponseMode;
  acceptance_party: DocumentAcceptanceParty;
  audience_scope: DocumentAudience;
  enforcement_scope: DocumentEnforcement;
  effective_at: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  affirmation_text: string | null;
  satisfied: boolean;
  student_completed: boolean;
  guardian_completed: boolean;
  minor: boolean | null;
  blocks_booking: boolean;
};

export type BookingRestriction = {
  code: string;
  type: string;
  title: string;
  detail?: string | null;
  action_kind?: string | null;
  action_href?: string | null;
  action_label?: string | null;
  version_id?: string | null;
  document_id?: string | null;
  document_name?: string | null;
  restriction_id?: string | null;
};

export const documentTypeLabels: Record<string, string> = {
  contract: "Contrato",
  regulation: "Reglamento",
  waiver: "Responsiva",
  privacy: "Aviso de privacidad",
  consent: "Consentimiento",
  notice: "Aviso",
  other: "Otro",
};

export const documentStatusLabels: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  active: "Vigente",
  superseded: "Sustituido",
  retired: "Retirado",
};

export const responseModeLabels: Record<string, string> = {
  accept_required: "Aceptación obligatoria",
  decision_optional: "Consentimiento opcional",
  informational: "Solo informativo",
};

export const acceptancePartyLabels: Record<string, string> = {
  student: "Alumna",
  guardian_if_minor: "Responsable si es menor",
  student_and_guardian: "Alumna + responsable",
  guardian_only: "Solo responsable",
};

export const audienceLabels: Record<string, string> = {
  all: "Todas las alumnas",
  adults: "Solo adultas",
  minors: "Solo menores",
  activity: "Actividades específicas",
  event: "Evento específico",
  student: "Alumnas específicas",
};

export const enforcementLabels: Record<string, string> = {
  global_booking: "Antes de cualquier nueva reserva",
  activity_booking: "Antes de reservar actividades seleccionadas",
  event_registration: "Antes de inscribirse al evento",
  none: "No genera restricción",
};

export function formatFileSize(bytes?: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}


export function safeReservationReturnTo(value?: string | null) {
  const candidate = String(value ?? "").trim();
  if (!candidate.startsWith("/student/reservar")) return null;
  if (candidate.startsWith("//")) return null;
  return candidate;
}
