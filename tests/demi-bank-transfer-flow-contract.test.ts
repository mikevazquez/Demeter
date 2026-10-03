import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi bank transfer flow", () => {
  const contracts = source("lib/assistant/tool-contracts.ts");
  const actions = source("lib/assistant/action-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const migration = source(
    "supabase/migrations/20261003172700_studio_bank_transfer_settings.sql",
  );
  const provisionalMigration = source(
    "supabase/migrations/20261003172800_demi_provisional_transfer_packages.sql",
  );
  const paymentPage = source("app/admin/configuracion/pagos/page.tsx");

  it("prepares a selected package with real configured bank details", () => {
    expect(contracts).toContain('name: "prepare_bank_transfer_purchase"');
    expect(actions).toContain("service_prepare_transfer_purchase");
    expect(provisionalMigration).toContain("product_not_compatible");
    expect(provisionalMigration).toContain("'receipt_required',true");
  });

  it("tells Demi to request the receipt and explain provisional activation", () => {
    expect(orchestrator).toContain(
      "llama prepare_bank_transfer_purchase",
    );
    expect(orchestrator).toContain(
      "el paquete se activará de forma provisional",
    );
    expect(orchestrator).toContain(
      "puede ser revocado si la transferencia no se confirma correctamente",
    );
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

  it("provides an owner settings and review page", () => {
    expect(paymentPage).toContain("Pagos y transferencias");
    expect(paymentPage).toContain("studio_bank_transfer_settings");
    expect(paymentPage).toContain("Comprobantes pendientes de validación");
    expect(paymentPage).toContain("Validar transferencia");
    expect(paymentPage).toContain("Rechazar y revocar");
  });
});
