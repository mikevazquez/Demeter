import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import * as personas from "../lib/assistant/prompt-workbench";

function simulationModule() {
  const code = transformSync(
    readFileSync("lib/assistant/test-simulation.ts", "utf8").replace('import "server-only";', ""),
    { loader: "ts", format: "cjs" },
  ).code;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => {
      if (name === "./prompt-workbench") return personas;
      if (name === "./action-tools") return { isExplicitAssistantConfirmation: () => false };
      throw new Error(`Unexpected external dependency: ${name}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports as typeof import("../lib/assistant/test-simulation");
}

const context = (state: ReturnType<ReturnType<typeof simulationModule>["createTestSimulation"]>) => ({
  state,
  supabase: {} as never,
  studio: { id: "sandbox-fixture" } as never,
  turnId: "turn-1",
  currentUserMessage: "",
});

describe("Workbench bench gaps: S03 validity and simulated follow-up", () => {
  it("exposes package validity with the real tool shape (S03)", () => {
    const sim = simulationModule();
    const status = sim.simulatedReadTool(sim.createTestSimulation("student"), "get_student_package_status") as {
      current_package: Record<string, unknown>;
      packages: unknown[];
    };
    expect(status.current_package).toMatchObject({
      available_credits: 8,
      credit_limit: 8,
      unlimited: false,
      depleted: false,
    });
    expect(status.current_package.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(status.current_package.starts_on) < String(status.current_package.expires_on)).toBe(true);
    expect(status.packages).toEqual([status.current_package]);
  });

  it("keeps prospects without a package", () => {
    const sim = simulationModule();
    const status = sim.simulatedReadTool(sim.createTestSimulation("prospect"), "get_student_package_status") as {
      current_package: unknown;
      packages: unknown[];
    };
    expect(status.current_package).toBeNull();
    expect(status.packages).toEqual([]);
  });

  it("simulates a follow-up stage without scheduling or sending anything", async () => {
    const sim = simulationModule();
    const state = sim.createTestSimulation("prospect");
    const ok = await sim.simulateAssistantAction(context(state), "update_contact_followup", {
      stage: "answering_questions",
      reason: null,
    });
    expect(ok).toMatchObject({ ok: true, simulated: true, status: "simulated", stage: "answering_questions" });
    expect(String((ok as { reason_message: string }).reason_message)).toContain("no se programan");
  });

  it("validates follow-up stages like the real contract", async () => {
    const sim = simulationModule();
    const state = sim.createTestSimulation("prospect");
    expect(
      await sim.simulateAssistantAction(context(state), "update_contact_followup", { stage: "x", reason: null }),
    ).toMatchObject({ ok: false, error: "invalid_stage" });
    expect(
      await sim.simulateAssistantAction(context(state), "update_contact_followup", {
        stage: "not_qualified",
        reason: "  ",
      }),
    ).toMatchObject({ ok: false, error: "reason_required" });
    expect(
      await sim.simulateAssistantAction(context(sim.createTestSimulation("student")), "update_contact_followup", {
        stage: "answering_questions",
        reason: null,
      }),
    ).toMatchObject({ ok: false, error: "followup_not_applicable" });
  });
});
