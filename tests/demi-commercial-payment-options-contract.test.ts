import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi commercial payment options", () => {
  const readTools = source("lib/assistant/read-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("returns only configured digital payment options with commercial offers", () => {
    expect(readTools).toContain('from("studio_payment_methods")');
    expect(readTools).toContain('"app_mercado_pago"');
    expect(readTools).toContain('"bank_transfer"');
    expect(readTools).toContain("online_purchasable === true");
  });

  it("tells Demi to mention Mercado Pago and transfer only when returned", () => {
    expect(orchestrator).toContain(
      "Si prepare_booking o prepare_reschedule falla por falta de créditos",
    );
    expect(orchestrator).toContain("No menciones métodos que no aparezcan en payment_options");
    expect(orchestrator).toContain(
      "Puedes pagarlo desde la app con Mercado Pago o por transferencia",
    );
  });
});
