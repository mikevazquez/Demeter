import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi provisional transfer package flow", () => {
  const migration = source(
    "supabase/migrations/20261003014000_demi_provisional_transfer_packages.sql",
  );
  const webhook = source(
    "app/api/integrations/meta-whatsapp/webhook/route.ts",
  );
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("stores a transfer intent before the receipt arrives", () => {
    expect(migration).toContain("assistant_transfer_purchase_intents");
    expect(contracts).toContain('name: "prepare_bank_transfer_purchase"');
    expect(actions).toContain("service_prepare_transfer_purchase");
    expect(actions).toContain('status: "awaiting_receipt"');
  });

  it("activates the selected package provisionally when an image or document receipt arrives", () => {
    expect(webhook).toContain("service_activate_transfer_receipt");
    expect(webhook).toContain('["image", "document"]');
    expect(webhook).toContain("transfer_receipt_provisional");
    expect(migration).toContain("'provisional_active'");
    expect(migration).toContain(
      "Activación provisional por comprobante de transferencia",
    );
  });

  it("warns that provisional access can be revoked", () => {
    expect(webhook).toContain(
      "el paquete puede ser revocado",
    );
    expect(orchestrator).toContain(
      "puede ser revocado si la transferencia no se confirma correctamente",
    );
  });

  it("supports final validation or rejection without deleting history", () => {
    expect(migration).toContain("admin_review_transfer_purchase");
    expect(migration).toContain("'validated'");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("cancelled_by_studio");
    expect(migration).toContain("'history_preserved',true");
  });

  it("does not record a bank payment until validation", () => {
    const activation = migration.slice(
      migration.indexOf("create or replace function public.service_activate_transfer_receipt"),
      migration.indexOf("create or replace function public.admin_review_transfer_purchase"),
    );
    expect(activation).not.toContain("insert into public.payments");
    expect(migration).toContain("Transferencia validada desde revisión de comprobante de Demi.");
  });
});
