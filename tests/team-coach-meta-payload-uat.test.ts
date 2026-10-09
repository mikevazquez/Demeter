import { describe, expect, it } from "vitest";

import {
  buildMetaWhatsAppTemplatePayload,
  META_WHATSAPP_TEMPLATE_PARAMETERS,
  normalizeMetaWhatsAppPhone,
} from "../supabase/functions/_shared/meta-whatsapp-template";

const base = {
  recipient: "523312345678",
  languageCode: "es_MX",
  variables: {
    recipient_name: "María López",
    class_name: "Pole Fitness",
    session_starts_at: "2026-11-01T16:30:00Z",
    studio_timezone: "America/Mexico_City",
    roster_count: 2,
    roster_names: "Ana, Luisa",
    minimum_required: 3,
    reservations_at_review: 1,
  },
};

function bodyParameters(payload: ReturnType<typeof buildMetaWhatsAppTemplatePayload>) {
  const body = payload.template.components?.find((component) => component.type === "body");
  return (body?.parameters as Array<{ type: string; text: string }> | undefined)?.map(
    (parameter) => parameter.text,
  );
}

describe("Equipo WhatsApp templates — Meta UAT contracts", () => {
  it("renders the six roster parameters in the approved Meta template order", () => {
    const payload = buildMetaWhatsAppTemplatePayload({
      ...base,
      internalTemplate: "coach_roster_reminder",
      metaTemplateName: "demeter_coach_lista_alumnas_v1",
    });
    expect(payload.template.name).toBe("demeter_coach_lista_alumnas_v1");
    expect(payload.template.language.code).toBe("es_MX");
    expect(payload.to).toBe(base.recipient);
    expect(META_WHATSAPP_TEMPLATE_PARAMETERS.coach_roster_reminder).toHaveLength(6);
    expect(bodyParameters(payload)).toEqual([
      "María López",
      "Pole Fitness",
      "01/11/2026",
      "10:30",
      "2",
      "Ana, Luisa",
    ]);
  });

  it("renders six cancellation parameters, including the minimum and actual reservations", () => {
    const payload = buildMetaWhatsAppTemplatePayload({
      ...base,
      internalTemplate: "class_cancelled_coach",
      metaTemplateName: "demeter_coach_cancelacion_minimo_v1",
    });
    expect(payload.template.name).toBe("demeter_coach_cancelacion_minimo_v1");
    expect(META_WHATSAPP_TEMPLATE_PARAMETERS.class_cancelled_coach).toHaveLength(6);
    expect(bodyParameters(payload)).toEqual([
      "María López",
      "Pole Fitness",
      "01/11/2026",
      "10:30",
      "3",
      "1",
    ]);
  });

  it("does not produce invalid or duplicated country prefixes for Mexican coach phones", () => {
    expect(normalizeMetaWhatsAppPhone("3312345678", "52")).toBe("523312345678");
    expect(normalizeMetaWhatsAppPhone("+52 33 1234 5678", "52")).toBe("523312345678");
    expect(normalizeMetaWhatsAppPhone("", "52")).toBeNull();
  });
});
