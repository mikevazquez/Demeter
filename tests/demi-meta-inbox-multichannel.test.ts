import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi Meta Inbox multichannel contract", () => {
  const channel = source("lib/assistant/meta-inbox-channel.ts");
  const route = source("app/api/integrations/meta-inbox/webhook/route.ts");
  const migration = source(
    "supabase/migrations/20261007162000_demi_meta_inbox_multichannel.sql",
  );
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const integrations = source("app/admin/integraciones/page.tsx");
  const page = source("app/admin/integraciones/meta-inbox/page.tsx");

  it("accepts both Messenger and Instagram webhook envelopes", () => {
    expect(channel).toContain('objectType === "instagram"');
    expect(channel).toContain('objectType === "page"');
    expect(channel).toContain('"facebook_messenger"');
    expect(channel).toContain("message.is_echo");
  });

  it("verifies Meta webhook token and HMAC signature before processing", () => {
    expect(route).toContain('url.searchParams.get("hub.verify_token")');
    expect(route).toContain('request.headers.get("x-hub-signature-256")');
    expect(channel).toContain('createHmac("sha256", appSecret)');
    expect(channel).toContain("timingSafeEqual");
  });

  it("keeps the same Demi orchestrator and Studio Flow CRM", () => {
    expect(route).toContain("runAssistantTurn");
    expect(route).toContain('"service_prepare_meta_inbox_message"');
    expect(route).toContain("channel: message.channel");
    expect(migration).toContain("insert into public.crm_contacts");
    expect(migration).toContain("'conversation.started'");
  });

  it("uses a cross-channel identity registry including WhatsApp", () => {
    expect(migration).toContain("create table if not exists public.assistant_channel_identities");
    expect(migration).toContain("'meta_whatsapp','instagram','facebook_messenger'");
    expect(migration).toContain("demi_sync_whatsapp_channel_identity");
    expect(migration).toContain(
      "unique (studio_id, provider, provider_account_id, provider_contact_id)",
    );
  });

  it("does not trust a typed phone number as Instagram or Messenger authentication", () => {
    expect(migration).toContain(
      "No phone typed in Instagram/Messenger is ever treated as authentication.",
    );
    expect(route).not.toContain("link_meta_inbox_identity_by_phone");
    expect(orchestrator).toContain(
      "No uses un teléfono escrito en el chat como prueba de identidad",
    );
  });

  it("limits Meta pilot actions to first-class transfer preparation", () => {
    expect(orchestrator).toContain('new Set(["prepare_booking"])');
    expect(orchestrator).toContain("metaProspectBookingEnabled");
    expect(orchestrator).toContain("metaProspectBookingTools.has(toolName)");
    expect(orchestrator).toContain("permittedMetaAction");
    expect(orchestrator).toContain('resultObject.status === "payment_offer"');
  });

  it("offers transfer before personal data and never books on a bare receipt", () => {
    const actionTools = source("lib/assistant/action-tools.ts");
    const trial = source("lib/assistant/meta-trial-transfer.ts");
    expect(actionTools).toContain('stage: "meta_offer_transfer"');
    expect(actionTools).toContain('status: "payment_offer"');
    expect(trial).toContain('stage: "meta_awaiting_receipt"');
    expect(trial).toContain('stage: "meta_awaiting_name"');
    expect(trial).toContain('stage: "meta_awaiting_phone"');
    expect(trial).toContain('^[0-9]{10}$');
    expect(trial).toContain('"assistant_ensure_trial_student"');
    expect(trial).toContain('"service_prepare_trial_transfer"');
    expect(trial).toContain('"receipt_validation_failed"');
    expect(trial).not.toContain('"service_activate_trial_transfer_receipt"');
    expect(trial).toContain('"assistant_confirm_trial_booking"');
    expect(trial).toContain('booking.payment_pending === true');
    expect(trial).toContain("la reserva puede ser revocada");
  });

  it("stores Meta receipts privately and does not trust arbitrary attachment URLs", () => {
    const trial = source("lib/assistant/meta-trial-transfer.ts");
    expect(channel).toContain("downloadMetaInboxAttachment");
    expect(channel).toContain('url.protocol !== "https:"');
    expect(channel).toContain('redirect: "error"');
    expect(trial).toContain('storage.from("transfer-receipts")');
    expect(trial).toContain("receipt_amount_matches");
    expect(route).toContain("continueMetaTrialTransfer");
  });

  it("protects secrets in Vault and the admin UI", () => {
    expect(migration).toContain("'meta_inbox_connection:' || target_studio_id::text");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("vault.update_secret");
    expect(page).toContain('type="password"');
    expect(page).toContain('name="page_access_token"');
    expect(page).toContain('name="instagram_access_token"');
    expect(page).toContain('name="app_secret"');
  });

  it("makes the integration discoverable in Studio Flow", () => {
    expect(integrations).toContain('href="/admin/integraciones/meta-inbox"');
    expect(integrations).toContain("Meta · Instagram + Facebook");
  });

  it("extends the assistant conversation channel without rewriting history", () => {
    expect(migration).toContain("'instagram'");
    expect(migration).toContain("'facebook_messenger'");
    expect(migration).not.toContain("delete from public.assistant_conversations");
  });

  it("preserves demo/off privacy and pilot allowlists", () => {
    expect(route).toContain("if (!runAssistant)");
    expect(route).toContain('"assistant_mode_not_live"');
    expect(route).toContain('liveMode === "pilot"');
    expect(route).toContain("pilotContactIds[message.provider]");
    expect(route).toContain('"pilot_contact_not_allowed"');
  });
});
