import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("student portal activation via Meta WhatsApp", () => {
  const provision = src("supabase/functions/provision-student-access/index.ts");
  const template = src("supabase/functions/_shared/meta-whatsapp-template.ts");

  it("uses Meta instead of Asistian", () => {
    expect(provision).toContain("sendMetaWhatsAppTemplate");
    expect(provision).toContain("sendActivationWhatsApp");
    expect(provision).not.toContain("sendAsistianWebhook");
  });

  it("enforces the Meta pilot allowlist before activation sends", () => {
    expect(provision).toContain("service_get_meta_whatsapp_pilot_wa_ids");
    expect(provision).toContain('runtimeConfig?.mode !== "pilot"');
    expect(provision).toContain("pilot_recipient_not_allowed");
  });

  it("fails closed when activation button config is missing", () => {
    expect(provision).toContain("META_STUDENT_ACTIVATION_BUTTON_BASE_URL");
    expect(provision).toContain("activation_button_configuration_unverified");
  });

  it("builds a dynamic URL button for student_welcome", () => {
    expect(template).toContain("activation_button_suffix");
    expect(template).toContain('sub_type: "url"');
    expect(template).toContain('index: "0"');
  });
});
