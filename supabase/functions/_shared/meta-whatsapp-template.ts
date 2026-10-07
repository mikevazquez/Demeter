import { buildAsistianVariables } from "./notification-asistian-variables.ts";

export const META_WHATSAPP_TEMPLATE_KEYS = [
  "student_welcome",
  "reservation_confirmed",
  "reservation_cancelled",
  "waitlist_promoted",
  "class_reminder",
  "class_cancelled_coach",
  "class_cancelled_student",
  "class_rescheduled",
  "evaluation_reminder",
  "package_activated",
  "package_expired",
  "package_expiring",
  "session_cancelled_by_studio",
] as const;

export type MetaWhatsAppTemplateKey = (typeof META_WHATSAPP_TEMPLATE_KEYS)[number];

const PARAMETER_ORDER: Record<MetaWhatsAppTemplateKey, readonly string[]> = {
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
};

function asTemplateText(value: unknown) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "—";
}

export function isMetaWhatsAppTemplateKey(value: string): value is MetaWhatsAppTemplateKey {
  return (META_WHATSAPP_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function normalizeMetaWhatsAppPhone(value: unknown, defaultCountryCallingCode = "52") {
  if (typeof value !== "string" || !value.trim()) return null;

  const digits = value.replace(/\D/g, "");
  const countryCode = defaultCountryCallingCode.replace(/\D/g, "");

  if (/^[1-9][0-9]{9}$/.test(digits) && /^[1-9][0-9]{0,2}$/.test(countryCode)) {
    return `${countryCode}${digits}`;
  }
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return digits;
  return null;
}

export function buildMetaWhatsAppTemplatePayload(input: {
  recipient: string;
  internalTemplate: MetaWhatsAppTemplateKey;
  metaTemplateName: string;
  languageCode: string;
  variables: Record<string, unknown>;
  headerImageId?: string | null;
}) {
  const mapped =
    input.internalTemplate === "student_welcome"
      ? {
          nombre:
            typeof input.variables.recipient_name === "string" &&
            input.variables.recipient_name.trim()
              ? input.variables.recipient_name.trim()
              : "Alumna",
        }
      : buildAsistianVariables(input.internalTemplate, input.variables);
  const parameters = PARAMETER_ORDER[input.internalTemplate].map((key) => ({
    type: "text" as const,
    text: asTemplateText(mapped[key]),
  }));

  const components: Array<Record<string, unknown>> = [];

  if (input.headerImageId) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            id: input.headerImageId,
          },
        },
      ],
    });
  }

  if (parameters.length) {
    components.push({
      type: "body",
      parameters,
    });
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.recipient,
    type: "template",
    template: {
      name: input.metaTemplateName,
      language: {
        code: input.languageCode,
      },
      ...(components.length ? { components } : {}),
    },
  };
}
