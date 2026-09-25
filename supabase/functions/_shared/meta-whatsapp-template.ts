import { buildAsistianVariables } from "./notification-asistian-variables.ts";

export const META_WHATSAPP_TEMPLATE_KEYS = [
  "student_welcome",
  "reservation_confirmed",
  "reservation_cancelled",
  "waitlist_promoted",
  "class_reminder",
  "class_cancelled_coach",
] as const;

export type MetaWhatsAppTemplateKey = (typeof META_WHATSAPP_TEMPLATE_KEYS)[number];

const PARAMETER_ORDER: Record<MetaWhatsAppTemplateKey, readonly string[]> = {
  student_welcome: ["nombre"],
  reservation_confirmed: ["nombre", "disciplina", "fecha", "hora", "coach", "ubicacion"],
  reservation_cancelled: [
    "clase",
    "fecha",
    "hora",
    "tipo_cancelacion",
    "credito_recuperado",
    "creditos_restantes",
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

export function normalizeMetaWhatsAppPhone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const digits = value.replace(/\D/g, "");
  if (/^[1-9][0-9]{9}$/.test(digits)) return `52${digits}`;
  if (/^52[1-9][0-9]{9}$/.test(digits)) return digits;
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return digits;
  return null;
}

export function buildMetaWhatsAppTemplatePayload(input: {
  recipient: string;
  internalTemplate: MetaWhatsAppTemplateKey;
  metaTemplateName: string;
  languageCode: string;
  variables: Record<string, unknown>;
}) {
  const mapped = buildAsistianVariables(input.internalTemplate, input.variables);
  const parameters = PARAMETER_ORDER[input.internalTemplate].map((key) => ({
    type: "text" as const,
    text: asTemplateText(mapped[key]),
  }));

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
      ...(parameters.length
        ? {
            components: [
              {
                type: "body" as const,
                parameters,
              },
            ],
          }
        : {}),
    },
  };
}
