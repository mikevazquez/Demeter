import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Meta WhatsApp admin diagnostics", () => {
  const page = source("app/admin/integraciones/meta-whatsapp/page.tsx");
  const actions = source("app/admin/integraciones/meta-whatsapp/actions.ts");
  const helper = source("lib/assistant/meta-whatsapp-admin.ts");

  it("reuses the encrypted server-side Meta connection instead of asking for tokens again", () => {
    expect(helper).toContain("loadMetaWhatsAppWebhookConfig");
    expect(helper).toContain("createServiceClient");
    expect(page).toContain("No necesitas volver a");
    expect(actions).toContain("verifyMetaWhatsAppConnection");
  });

  it("can verify the number and list WABA subscriptions without exposing secrets", () => {
    expect(helper).toContain("display_phone_number,verified_name,quality_rating");
    expect(helper).toContain("/subscribed_apps?limit=50");
    expect(page).toContain("Apps suscritas a la WABA");
    expect(page).not.toContain("diagnostics.accessToken");
  });

  it("can subscribe the current app to the WABA with the stored token", () => {
    expect(helper).toContain("subscribed_apps");
    expect(helper).toContain('method: "POST"');
    expect(actions).toContain("subscribeCurrentMetaWhatsAppApp");
    expect(page).toContain("Suscribir app a la WABA");
  });

  it("sends test messages only with approved templates", () => {
    expect(helper).toContain("message_templates?limit=100");
    expect(helper).toContain('status !== "APPROVED"');
    expect(helper).toContain('type: "template"');
    expect(page).toContain("Plantilla aprobada");
    expect(actions).toContain("sendMetaWhatsAppTestMessage");
  });

  it("keeps diagnostic calls server-only and does not render the stored access token", () => {
    expect(helper).toContain('import "server-only"');
    expect(helper).toContain('authorization: `Bearer ${config.accessToken}`');
    expect(page).not.toContain("config.accessToken");
  });
});
