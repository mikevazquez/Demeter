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

  it("allows approved Meta activation without a pilot allowlist", () => {
    expect(provision).not.toContain("pilot_recipient_not_allowed");
    expect(provision).not.toContain("service_get_meta_whatsapp_pilot_wa_ids");
    expect(provision).toContain("sendMetaWhatsAppTemplate");
  });

  it("passes the activation URL through the approved welcome body parameter", () => {
    expect(provision).toContain("activation_url: input.activationLink");
    expect(provision).toContain('metaTemplateNameOverride: "bienvenida_alumna_portal"');
    expect(template).toContain('student_welcome: ["nombre", "activation_url"]');
    expect(template).not.toContain("activation_button_suffix");
  });
});
