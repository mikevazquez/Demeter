import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi transfer receipt storage", () => {
  const webhook = source("app/api/integrations/meta-whatsapp/webhook/route.ts");
  const channel = source("lib/assistant/meta-whatsapp-channel.ts");
  const profile = source("app/admin/alumnas/[studentId]/page.tsx");
  const migration = source(
    "supabase/migrations/20261003134500_demi_transfer_receipt_storage.sql",
  );

  it("stores receipt media in a private dedicated bucket", () => {
    expect(migration).toContain("'transfer-receipts'");
    expect(migration).toContain("false");
    expect(migration).toContain("receipt_storage_path");
    expect(migration).toContain("receipt_mime_type");
  });

  it("downloads Meta media with the configured access token", () => {
    expect(channel).toContain("downloadMetaWhatsAppMedia");
    expect(channel).toContain("authorization:");
    expect(channel).toContain("meta_media_metadata_failed");
    expect(channel).toContain("meta_media_download_failed");
  });

  it("persists the file and metadata after provisional activation", () => {
    expect(webhook).toContain('.from("transfer-receipts")');
    expect(webhook).toContain("receipt_storage_path");
    expect(webhook).toContain("receipt_stored_at");
    expect(webhook).toContain("transfer_receipt_storage_failed");
  });

  it("shows the private receipt from Profile 360 with a short-lived signed URL", () => {
    expect(profile).toContain("createSignedUrl(path, 600)");
    expect(profile).toContain("Comprobante guardado de forma privada");
    expect(profile).toContain("transferReceiptUrlMap");
  });
});
