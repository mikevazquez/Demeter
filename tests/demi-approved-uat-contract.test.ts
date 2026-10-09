import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi approved UAT behavior", () => {
  const reads = source("lib/assistant/read-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const actions = source("lib/assistant/action-tools.ts");

  it("keeps named activity searches scoped to the exact activity when possible", () => {
    expect(reads).toContain("exactTemplateMatchExists");
    expect(reads).toContain("templateName === activityNeedle");
    expect(orchestrator).toContain("no mezcles actividades no relacionadas");
    expect(contracts).toContain("conserva ese nombre exacto en activity_query");
  });

  it("cancels on-time reservations without a second confirmation", () => {
    expect(actions).toContain("if (!snapshot.summary.late)");
    expect(orchestrator).toContain("No pidas otra confirmación");
    expect(orchestrator).toContain(
      "Usa execute_cancellation únicamente para una cancelación tardía",
    );
    expect(contracts).toContain(
      "Cancela directamente una reserva si está dentro del tiempo permitido",
    );
  });

  it("keeps on-time reschedule messaging concise", () => {
    expect(orchestrator).toContain("NO menciones créditos, devolución, liberación, reutilización");
  });
});
