import { describe, expect, it } from "vitest";

import {
  buildMetaWhatsAppTemplatePayload,
  normalizeMetaWhatsAppPhone,
} from "../supabase/functions/_shared/meta-whatsapp-template";

describe("WHATSAPP-META-01 direct Cloud API payloads", () => {
  it("normalizes a Mexican local phone for Meta without the plus sign", () => {
    expect(normalizeMetaWhatsAppPhone("33 3638 6674", "52")).toBe("523336386674");
    expect(normalizeMetaWhatsAppPhone("+52 33 3638 6674", "52")).toBe("523336386674");
  });

  it("builds the approved-template payload for a reservation confirmation", () => {
    const payload = buildMetaWhatsAppTemplatePayload({
      recipient: "523336386674",
      internalTemplate: "reservation_confirmed",
      metaTemplateName: "demeter_reserva_confirmada",
      languageCode: "es_MX",
      variables: {
        recipient_name: "Mike",
        discipline_name: "Pole Fitness",
        session_starts_at: "2026-09-27T21:00:00.000Z",
        studio_timezone: "America/Mexico_City",
        coach: "Coach Demo",
        location: "Demeter",
      },
    });

    expect(payload).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "523336386674",
      type: "template",
      template: {
        name: "demeter_reserva_confirmada",
        language: { code: "es_MX" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Mike" },
              { type: "text", text: "Pole Fitness" },
              { type: "text", text: "27/09/2026" },
              { type: "text", text: "15:00" },
              { type: "text", text: "Coach Demo" },
              { type: "text", text: "Demeter" },
            ],
          },
        ],
      },
    });
  });

  it("maps the welcome recipient name into the Meta template", () => {
    const payload = buildMetaWhatsAppTemplatePayload({
      recipient: "523336386674",
      internalTemplate: "student_welcome",
      metaTemplateName: "demeter_bienvenida",
      languageCode: "es_MX",
      variables: { recipient_name: "Ximena" },
    });

    expect(payload.template.components[0]?.parameters).toEqual([
      { type: "text", text: "Ximena" },
    ]);
  });

  it("renders booleans and missing cancellation values as template-safe text", () => {
    const payload = buildMetaWhatsAppTemplatePayload({
      recipient: "523336386674",
      internalTemplate: "reservation_cancelled",
      metaTemplateName: "demeter_reserva_cancelada",
      languageCode: "es_MX",
      variables: {
        class_name: "Pole Fitness",
        session_starts_at: "2026-09-27T21:00:00.000Z",
        studio_timezone: "America/Mexico_City",
        to_status: "cancelled_late",
        credits_remaining: 3,
      },
    });

    expect(payload.template.components[0]?.parameters.map((parameter) => parameter.text)).toEqual([
      "Pole Fitness",
      "27/09/2026",
      "15:00",
      "Tardía",
      "No",
      "3",
    ]);
  });
});
