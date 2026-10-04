import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi trial cancellation credit handling", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("does not model a trial reservation without an acquisition as using credits", () => {
    expect(actions).toContain("const usesCredits = Boolean(reservation.acquisition_id)");
    expect(actions).toContain("const creditCost = usesCredits");
    expect(actions).toContain(": 0;");
    expect(actions).toContain("credit_will_return: usesCredits");
  });

  it("prevents user-facing credit-return language for trial cancellations", () => {
    expect(orchestrator).toContain(
      "no digas que se devuelve, recupera o pierde un crédito",
    );
  });
});
