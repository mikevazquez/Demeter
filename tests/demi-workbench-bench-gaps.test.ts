import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import * as personas from "../lib/assistant/prompt-workbench";

type Simulation = typeof import("../lib/assistant/test-simulation");
type State = ReturnType<Simulation["createTestSimulation"]>;

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
  return loadedModule.exports as Simulation;
}

const context = (state: State) => ({
  state,
  supabase: {} as never,
  studio: { id: "sandbox-fixture" } as never,
  turnId: "turn-1",
  currentUserMessage: "",
});

type PackageStatus = { current_package: Record<string, unknown> | null; packages: unknown[] };

describe("Workbench bench gaps: S03 validity and simulated follow-up", () => {
  it("exposes package validity with the real tool shape (S03)", () => {
    const sim = simulationModule();
    const state = sim.createTestSimulation("student");
    const status = sim.simulatedReadTool(state, "get_student_package_status") as PackageStatus;
    const current = status.current_package!;
    expect(current).toMatchObject({
      available_credits: 8,
      credit_limit: 8,
      unlimited: false,
      depleted: false,
    });
    expect(current.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(current.starts_on) < String(current.expires_on)).toBe(true);
    expect(status.packages).toEqual([current]);
  });

  it("keeps prospects without a package", () => {
    const sim = simulationModule();
    const state = sim.createTestSimulation("prospect");
    const status = sim.simulatedReadTool(state, "get_student_package_status") as PackageStatus;
    expect(status.current_package).toBeNull();
    expect(status.packages).toEqual([]);
  });

  it("simulates a follow-up stage without scheduling or sending anything", async () => {
    const sim = simulationModule();
    const state = sim.createTestSimulation("prospect");
    const args = { stage: "answering_questions", reason: null };
    const ok = await sim.simulateAssistantAction(context(state), "update_contact_followup", args);
    expect(ok).toMatchObject({ ok: true, simulated: true, status: "simulated" });
    expect(ok).toMatchObject({ stage: "answering_questions" });
    expect(String(ok.reason_message)).toContain("no se programan");
  });

  it("validates follow-up stages like the real contract", async () => {
    const sim = simulationModule();
    const run = (state: State, args: Record<string, unknown>) =>
      sim.simulateAssistantAction(context(state), "update_contact_followup", args);
    const prospect = sim.createTestSimulation("prospect");
    const student = sim.createTestSimulation("student");
    expect(await run(prospect, { stage: "x", reason: null })).toMatchObject({
      ok: false,
      error: "invalid_stage",
    });
    expect(await run(prospect, { stage: "not_qualified", reason: "  " })).toMatchObject({
      ok: false,
      error: "reason_required",
    });
    expect(await run(student, { stage: "answering_questions", reason: null })).toMatchObject({
      ok: false,
      error: "followup_not_applicable",
    });
  });
});
