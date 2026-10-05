import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi reschedule cutoff policy", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("allows late reschedules but marks the extra credit consequence", () => {
    const prepare = actions.slice(
      actions.indexOf("async function prepareReschedule"),
      actions.indexOf("async function executeReschedule"),
    );

    expect(prepare).not.toContain('"reschedule_cutoff_passed"');
    expect(prepare).toContain("late_reschedule: source.summary.late === true");
    expect(prepare).toContain("additional_credit_required");
    expect(prepare).toContain("source.summary.credit_will_return === false");
  });

  it("rechecks consequences at confirmation and requires a new confirmation if they changed", () => {
    const execute = actions.slice(
      actions.indexOf("async function executeReschedule"),
      actions.indexOf("function safeWaitlistReason"),
    );

    expect(execute).not.toContain('"reschedule_cutoff_passed"');
    expect(execute).toContain("previousConsequence !== currentConsequence");
    expect(execute).toContain("consequence_changed: true");
    expect(execute).toContain("original_reservation_preserved: true");
  });

  it("treats a late reschedule as late cancellation plus a new booking", () => {
    expect(orchestrator).toContain("Si ya es cancelación tardía, sí se puede reagendar");
    expect(orchestrator).toContain(
      "el crédito de la clase original no regresa y la nueva reserva usa otro crédito disponible",
    );
  });
});
