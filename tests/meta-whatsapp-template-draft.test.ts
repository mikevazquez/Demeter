import { describe, expect, it } from "vitest";

import { validateMetaWhatsAppTemplateDraft } from "../lib/notifications/meta-template-catalog";

describe("Meta WhatsApp template draft validation", () => {
  it("accepts the exact ordered variables in a valid template", () => {
    expect(
      validateMetaWhatsAppTemplateDraft({
        name: "demeter_reserva_confirmada_v1",
        languageCode: "es_MX",
        category: "UTILITY",
        body: "Hola {{1}}, tu lugar en {{2}} está reservado.",
        expectedVariables: 2,
      }),
    ).toBeNull();
  });

  it("rejects missing, skipped, and extra variables but allows reuse", () => {
    for (const body of ["sin variables", "Hola {{2}}", "{{1}} {{2}} {{3}}"])
      expect(
        validateMetaWhatsAppTemplateDraft({
          name: "demeter_test_v1",
          languageCode: "es_MX",
          category: "UTILITY",
          body,
          expectedVariables: 2,
        }),
      ).toBe("meta_template_variables_invalid");

    expect(
      validateMetaWhatsAppTemplateDraft({
        name: "demeter_test_v1",
        languageCode: "es_MX",
        category: "UTILITY",
        body: "Hola {{1}}, te esperamos, {{1}}. Tu clase es {{2}}.",
        expectedVariables: 2,
      }),
    ).toBeNull();
  });

  it("rejects invalid Meta names, languages, and categories", () => {
    const valid = {
      name: "demeter_test",
      languageCode: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}}",
      expectedVariables: 1,
    };
    expect(validateMetaWhatsAppTemplateDraft({ ...valid, name: "Demeter Test" })).toBe(
      "meta_template_name_invalid",
    );
    expect(validateMetaWhatsAppTemplateDraft({ ...valid, languageCode: "es-mx" })).toBe(
      "meta_template_language_invalid",
    );
    expect(validateMetaWhatsAppTemplateDraft({ ...valid, category: "PROMO" })).toBe(
      "meta_template_category_invalid",
    );
  });
});
