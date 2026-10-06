import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi transfer receipt UAT", () => {
  const actions = source("app/admin/integraciones/demi/actions.ts");
  const chat = source("app/admin/integraciones/demi/DemiChat.tsx");

  it("runs the internal demo with the same service-only transfer tools as WhatsApp", () => {
    expect(actions).toContain("createServiceClient");
    expect(actions).toContain("serviceMode: true");
    expect(actions).toContain("service_prepare_transfer_purchase");
  });

  it("accepts a receipt file and uses the real provisional activation RPC", () => {
    expect(actions).toContain("sendDemiReceipt");
    expect(actions).toContain("service_activate_transfer_receipt");
    expect(actions).toContain('from("transfer-receipts")');
    expect(actions).toContain("receipt_storage_path");
    expect(actions).toContain("transfer_receipt_review");
  });

  it("exposes the receipt control only for an identified student conversation", () => {
    expect(chat).toContain("Adjuntar comprobante");
    expect(chat).toContain('identityValue.startsWith("student:")');
    expect(chat).toContain("sendDemiReceipt");
  });
});
