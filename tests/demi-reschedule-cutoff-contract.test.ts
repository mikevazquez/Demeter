import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi reschedule cutoff policy", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("blocks preparing a reschedule after the source cancellation cutoff", () => {
    const prepare = actions.slice(
      actions.indexOf("async function prepareReschedule"),
      actions.indexOf("async function executeReschedule"),
    );

    expect(prepare).toContain("source.summary.late === true");
    expect(prepare).toContain('"reschedule_cutoff_passed"');
  });

  it("rechecks the cutoff at confirmation and preserves the original booking", () => {
    const execute = actions.slice(
      actions.indexOf("async function executeReschedule"),
      actions.indexOf("function safeWaitlistReason"),
    );

    expect(execute).toContain("source.summary.late === true");
    expect(execute).toContain("original_reservation_preserved: true");
    expect(execute).toContain('status: "cancelled"');
  });

  it("forbids using a reschedule to bypass late cancellation policy", () => {
    expect(orchestrator).toContain(
      "Nunca uses un reagendado para evitar una cancelación tardía",
    );
  });
});
