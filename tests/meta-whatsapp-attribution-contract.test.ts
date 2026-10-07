import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Meta WhatsApp attribution funnel", () => {
  const channel = source("lib/assistant/meta-whatsapp-channel.ts");
  const webhook = source("app/api/integrations/meta-whatsapp/webhook/route.ts");
  const migration = source("supabase/migrations/20261007071500_meta_whatsapp_referral_attribution.sql");
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("captures click-to-WhatsApp referral metadata", () => {
    expect(channel).toContain("MetaInboundReferral");
    expect(channel).toContain("ctwa_clid");
    expect(channel).toContain("source_id");
    expect(channel).toContain("referralForMessage");
    expect(webhook).toContain("service_record_meta_whatsapp_referral");
  });

  it("stores attribution on the existing CRM conversation", () => {
    expect(migration).toContain("service_record_meta_whatsapp_referral");
    expect(migration).toContain("meta_referral");
    expect(migration).toContain("Meta Ads");
  });

  it("shows tracked conversations and sources in Intelligence", () => {
    expect(intelligence).toContain('from("crm_conversations")');
    expect(intelligence).toContain("Conversaciones rastreadas");
    expect(intelligence).toContain("Prospectos únicos");
    expect(intelligence).toContain("Meta Ads atribuidas");
    expect(intelligence).toContain("históricas");
  });
});
