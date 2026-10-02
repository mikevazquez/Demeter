import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi Meta WhatsApp inbound contract", () => {
  const route = source(
    "app/api/integrations/meta-whatsapp/webhook/route.ts",
  );
  const channel = source("lib/assistant/meta-whatsapp-channel.ts");
  const migration = source(
    "supabase/migrations/20261002143000_demi_meta_whatsapp_inbound.sql",
  );

  it("validates Meta verification and signed webhook payloads", () => {
    expect(route).toContain('url.searchParams.get("hub.verify_token")');
    expect(route).toContain(
      'request.headers.get("x-hub-signature-256")',
    );
    expect(route).toContain("verifyMetaWebhookToken");
    expect(route).toContain("verifyMetaWebhookSignature");
    expect(channel).toContain('createHmac("sha256", appSecret)');
    expect(channel).toContain("timingSafeEqual");
  });

  it("deduplicates provider messages independently from Asistian", () => {
    expect(migration).toContain(
      "unique (studio_id, provider, provider_event_id)",
    );
    expect(migration).toContain(
      "assistant_turns_channel_message_unique_idx",
    );
    expect(route).toContain('error?.code !== "23505"');
    expect(migration).not.toContain(
      "references public.asistian_webhook_events",
    );
  });

  it("keeps Asistian isolated and Meta scoped to its own provider", () => {
    expect(migration).toContain(
      "provider text not null default 'meta_whatsapp'",
    );
    expect(migration).toContain("c.provider = 'meta_whatsapp'");
    expect(migration).not.toContain("update public.asistian_webhook_events");
    expect(route).not.toContain("receive-asistian-webhook");
  });

  it("requires service role for inbound preparation and protects secrets", () => {
    expect(migration).toContain(
      "service_get_meta_whatsapp_webhook_config",
    );
    expect(migration).toContain(
      "coalesce((select auth.role()), '') <> 'service_role'",
    );
    expect(migration).toContain(
      "grant execute on function public.service_prepare_meta_whatsapp_message",
    );
    expect(migration).toContain("to service_role;");
    expect(migration).toContain("vault.update_secret");
  });

  it("does not reply until Demi is explicitly placed in pilot or active mode", () => {
    expect(route).toContain(
      'const sendReplies = liveMode === "pilot" || liveMode === "active";',
    );
    expect(route).toContain(
      'const runAssistant = sendReplies || liveMode === "shadow";',
    );
    expect(route).toContain('"assistant_mode_not_live"');
  });

  it("limits pilot mode to explicitly authorized WhatsApp contacts", () => {
    expect(channel).toContain("service_get_meta_whatsapp_pilot_wa_ids");
    expect(channel).toContain("pilotWaIds");
    expect(route).toContain('if (liveMode === "pilot")');
    expect(route).toContain('"pilot_contact_not_allowed"');
    expect(route).toContain("webhookConfig.pilotWaIds.includes");
  });

  it("does not persist real inbound content while Demi is demo/off", () => {
    const modeGuard = route.indexOf('if (!runAssistant)');
    const capture = route.indexOf("await captureEvent");
    expect(modeGuard).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(-1);
    expect(modeGuard).toBeLessThan(capture);
  });

  it("stops automation while human takeover is open", () => {
    expect(route).toContain("prepared.handoff_open === true");
    expect(route).toContain('"human_takeover_active"');
    expect(route).toContain('"whatsapp_media_review"');
  });

  it("uses Studio Flow identity and a service-mode assistant runtime", () => {
    expect(route).toContain(
      '"service_prepare_meta_whatsapp_message"',
    );
    expect(route).toContain("serviceMode: true");
    expect(migration).toContain("from public.students s");
    expect(migration).toContain("insert into public.crm_contacts");
    expect(migration).toContain("'whatsapp'");
  });
});

describe("Meta inbound admin setup contract", () => {
  const page = source("app/admin/integraciones/meta-whatsapp/page.tsx");
  const actions = source(
    "app/admin/integraciones/meta-whatsapp/actions.ts",
  );

  it("accepts the App Secret only through a password field and Vault RPC", () => {
    expect(page).toContain('type="password"');
    expect(page).toContain('name="app_secret"');
    expect(actions).toContain('"admin_set_meta_whatsapp_inbound"');
    expect(page).not.toContain("value={appSecret}");
  });

  it("shows the Sandbox callback URL without embedding a secret", () => {
    expect(page).toContain(
      "/api/integrations/meta-whatsapp/webhook?studio=",
    );
    expect(page).toContain("Callback URL de este Preview");
    expect(page).toContain(
      "No lo pegues en el chat",
    );
  });
});
