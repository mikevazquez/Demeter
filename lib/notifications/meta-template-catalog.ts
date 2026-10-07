export const META_WHATSAPP_TEMPLATE_PARAMETERS = {
  student_welcome: ["nombre"],
  reservation_confirmed: ["nombre", "disciplina", "fecha", "hora", "coach", "ubicacion"],
  reservation_cancelled: [
    "nombre",
    "clase",
    "fecha",
    "hora",
    "tipo_cancelacion",
    "credito_recuperado",
  ],
  waitlist_promoted: ["nombre", "disciplina", "fecha", "hora", "coach", "ubicacion"],
  class_reminder: ["nombre", "disciplina", "fecha", "hora", "coach", "ubicacion"],
  class_cancelled_coach: [
    "coach",
    "clase",
    "fecha",
    "hora",
    "minimo_reservas",
    "reservas_al_revisar",
  ],
  class_cancelled_student: ["nombre", "clase", "fecha", "hora"],
  class_rescheduled: [
    "nombre",
    "clase",
    "fecha_anterior",
    "hora_anterior",
    "fecha_nueva",
    "hora_nueva",
  ],
  evaluation_reminder: ["nombre", "disciplina", "fecha", "hora"],
  package_activated: ["nombre", "fecha_inicio", "fecha_vencimiento"],
  package_expired: ["nombre", "fecha_vencimiento"],
  package_expiring: ["nombre", "fecha_vencimiento", "dias_restantes"],
  session_cancelled_by_studio: ["nombre", "clase", "fecha", "hora"],
  challenge_invitation: ["nombre", "reto"],
  workshop_event: ["nombre", "evento", "fecha"],
  referral_invitation: ["nombre"],
  package_recovery_1: ["nombre", "paquete", "fecha_vencimiento"],
  package_recovery_2: ["nombre"],
  attendance_no_show: ["nombre", "clase", "fecha"],
  credit_restored: ["nombre", "clase", "fecha"],
  document_new_version: ["nombre", "documento"],
  documents_pending: ["nombre", "documentos"],
  evaluation_completed: ["nombre", "disciplina"],
  evaluation_invitation: ["nombre", "disciplina"],
  evaluation_scheduled: ["nombre", "disciplina", "fecha", "hora"],
  guardian_signature_pending: ["nombre", "documento"],
  password_reset: ["nombre"],
  payment_confirmed: ["nombre", "monto", "fecha"],
  payment_pending: ["nombre", "monto", "fecha_vencimiento"],
  session_coach_changed: ["nombre", "clase", "coach", "fecha", "hora"],
  studio_closure: ["nombre", "estudio", "fecha"],
  waitlist_expired: ["nombre", "clase", "fecha"],
} as const;

export type MetaWhatsAppTemplateKey = keyof typeof META_WHATSAPP_TEMPLATE_PARAMETERS;
export const META_WHATSAPP_TEMPLATE_KEYS = Object.keys(
  META_WHATSAPP_TEMPLATE_PARAMETERS,
) as MetaWhatsAppTemplateKey[];

const NOTIFICATION_TEMPLATE_ALIASES: Record<string, MetaWhatsAppTemplateKey> = {
  account_created: "student_welcome",
  late_cancellation: "reservation_cancelled",
  reservation_modified: "class_rescheduled",
  reservation_cancelled_by_student: "reservation_cancelled",
  session_cancelled_by_studio: "class_cancelled_student",
};

export function metaTemplateKeyForNotification(
  templateKey: string,
): MetaWhatsAppTemplateKey | null {
  if (isMetaWhatsAppTemplateKey(templateKey)) return templateKey;
  return NOTIFICATION_TEMPLATE_ALIASES[templateKey] ?? null;
}

export function isMetaWhatsAppTemplateKey(value: string): value is MetaWhatsAppTemplateKey {
  return Object.prototype.hasOwnProperty.call(META_WHATSAPP_TEMPLATE_PARAMETERS, value);
}

export function metaWhatsAppStatusLabel(status: string) {
  switch (status.trim().toUpperCase()) {
    case "APPROVED":
      return "Aprobada";
    case "REJECTED":
      return "Rechazada";
    default:
      return "Pendiente";
  }
}

export function validateMetaWhatsAppTemplateDraft(input: {
  name: string;
  languageCode: string;
  category: string;
  body: string;
  expectedVariables: number;
}) {
  if (!/^[a-z0-9_]{1,512}$/.test(input.name.trim().toLowerCase()))
    return "meta_template_name_invalid";
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(input.languageCode.trim()))
    return "meta_template_language_invalid";
  if (input.body.trim().length < 1 || input.body.trim().length > 1024)
    return "meta_template_body_invalid";
  if (input.category !== "UTILITY" && input.category !== "MARKETING")
    return "meta_template_category_invalid";

  const placeholders = [...input.body.matchAll(/{{\s*(\d+)\s*}}/g)].map((match) =>
    Number(match[1]),
  );
  const unique = [...new Set(placeholders)].sort((left, right) => left - right);
  if (
    unique.length !== input.expectedVariables ||
    unique.some((value, index) => value !== index + 1)
  )
    return "meta_template_variables_invalid";
  return null;
}
