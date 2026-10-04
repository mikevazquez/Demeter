import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi cancellation confirmation policy", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("executes on-time cancellations directly", () => {
    expect(actions).toContain("if (!snapshot.summary.late)");
    expect(actions).toContain('status: "executed"');
    expect(actions).toContain('"service_cancel_reservation"');
  });

  it("keeps late cancellations behind explicit confirmation", () => {
    expect(contracts).toContain(
      "Si la cancelación es tardía, calcula la consecuencia real y devuelve confirmation_required",
    );
    expect(orchestrator).toContain(
      "Si prepare_cancellation devuelve status=confirmation_required",
    );
    expect(orchestrator).toContain(
      "Usa execute_cancellation únicamente para una cancelación tardía",
    );
  });

  it("keeps on-time user messaging concise", () => {
    expect(orchestrator).toContain(
      "No pidas otra confirmación",
    );
    expect(orchestrator).toContain(
      "no expliques mecánicas internas de liberar o reutilizar créditos",
    );
  });
});
