import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi bank transfer flow", () => {
  const contracts = source("lib/assistant/tool-contracts.ts");
  const readTools = source("lib/assistant/read-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const migration = source(
    "supabase/migrations/20261003011000_studio_bank_transfer_settings.sql",
  );
  const paymentPage = source("app/admin/configuracion/pagos/page.tsx");

  it("exposes a dedicated bank transfer instructions tool", () => {
    expect(contracts).toContain('name: "get_bank_transfer_instructions"');
    expect(readTools).toContain("service_get_bank_transfer_settings");
    expect(readTools).toContain('payment_status: "pending_validation"');
    expect(readTools).toContain("credits_activate_before_validation: false");
  });

  it("only returns bank details for a compatible selected package", () => {
    expect(readTools).toContain("getCommercialOptions");
    expect(readTools).toContain("product_not_compatible");
    expect(readTools).toContain('receipt_required: true');
  });

  it("tells Demi to request the receipt without activating credits", () => {
    expect(orchestrator).toContain(
      "Cuando ya haya elegido el paquete, llama get_bank_transfer_instructions",
    );
    expect(orchestrator).toContain(
      "No actives créditos, no afirmes que el pago fue recibido",
    );
    expect(orchestrator).toContain("transfer_receipt_review");
  });

  it("keeps bank settings server/admin only", () => {
    expect(migration).toContain(
      "revoke all on table public.studio_bank_transfer_settings from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.service_get_bank_transfer_settings(uuid)",
    );
    expect(migration).toContain("to service_role;");
  });

  it("provides an owner settings page for real bank details", () => {
    expect(paymentPage).toContain("Pagos y transferencias");
    expect(paymentPage).toContain("studio_bank_transfer_settings");
  });
});
