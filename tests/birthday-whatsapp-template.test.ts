import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildAsistianVariables } from "../supabase/functions/_shared/notification-asistian-variables";
import { describe, expect, it } from "vitest";
import {
  META_WHATSAPP_TEMPLATE_PARAMETERS,
  validateMetaWhatsAppTemplateDraft,
} from "../lib/notifications/meta-template-catalog";
import {
  BIRTHDAY_META_BODY,
  birthdayMessage,
} from "../supabase/functions/_shared/birthday-notification";

const edgeModule = {
  exports: {} as {
    META_WHATSAPP_TEMPLATE_PARAMETERS: Record<string, readonly string[]>;
    buildMetaWhatsAppTemplatePayload: (input: Record<string, unknown>) => {
      template: { components: unknown[] };
    };
  },
};
const source = readFileSync("supabase/functions/_shared/meta-whatsapp-template.ts", "utf8").replace(
  /^import[\s\S]*?;\n/gm,
  "",
);
runInNewContext(
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: edgeModule.exports, module: edgeModule, buildAsistianVariables },
);
const { buildMetaWhatsAppTemplatePayload, META_WHATSAPP_TEMPLATE_PARAMETERS: edgeParameters } =
  edgeModule.exports;

describe("Birthday greeting payload", () => {
  it("registers and sends the same two parameters in the same order", () => {
    expect(META_WHATSAPP_TEMPLATE_PARAMETERS.birthday).toEqual(edgeParameters.birthday);
    expect(
      validateMetaWhatsAppTemplateDraft({
        name: "demeter_cumpleanos",
        languageCode: "es_MX",
        category: "MARKETING",
        body: BIRTHDAY_META_BODY,
        expectedVariables: 2,
      }),
    ).toBeNull();
    const payload = buildMetaWhatsAppTemplatePayload({
      recipient: "525555555555",
      internalTemplate: "birthday",
      metaTemplateName: "demeter_cumpleanos",
      languageCode: "es_MX",
      variables: {
        recipient_name: "Camila Torres",
        studio_name: "Demeter",
        birthday_on: "2026-10-20",
        birth_date: "1995-10-20",
      },
    });
    expect(payload.template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Camila Torres" },
          { type: "text", text: "Demeter" },
        ],
      },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/1995|birth_date|birthday_on/);
    expect(birthdayMessage("Camila Torres", "Demeter")).toBe(
      "¡Feliz cumpleaños, Camila Torres! En Demeter celebramos contigo y te deseamos un día lleno de alegría. Gracias por ser parte de nuestra comunidad.",
    );
  });
  it("preserves literal replacement characters in names", () => {
    expect(birthdayMessage("Ana $&", "Studio $1")).toContain("Ana $&! En Studio $1 celebramos");
  });
});
