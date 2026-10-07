import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationGuidance,
  needsFirstVisitGuidance,
} from "../lib/assistant/conversation-guidance";
import { validPrompt } from "../lib/assistant/prompt-workbench";

// Load server modules with explicit fakes for external boundaries. No network or real DB.
function serverModule<T>(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(path, "utf8").replace('import "server-only";', "");
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports as T;
}

function fakeDatabase() {
  const writes: string[] = [];
  const reads: string[] = [];
  const supabase = {
    from(table: string) {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: () => {
          writes.push(table);
          return chain;
        },
        single: async () => ({ data: { id: "model-call" }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
  };
  return { supabase, reads, writes };
}

function orchestratorHarness() {
  const action = vi.fn().mockRejectedValue(new Error("Real actions must never execute in a test"));
  const simulate = vi.fn().mockResolvedValue({ ok: true, simulated: true });
  const read = vi.fn().mockResolvedValue({ ok: true, activities: [] });
  const db = fakeDatabase();
  const mod = serverModule<typeof import("../lib/assistant/orchestrator")>(
    "lib/assistant/orchestrator.ts",
    {
      "./costs": { estimateModelCostUsdMicros: () => ({ usdMicros: 10 }) },
      "./test-simulation": { simulateAssistantAction: simulate, simulatedReadTool: () => null },
      "./action-tools": {
        executeAssistantActionTool: action,
        isExplicitAssistantConfirmation: () => true,
        parsePostTrialEnrollmentMethod: () => "cash",
      },
      "./read-tools": { executeAssistantReadTool: read },
      "./conversation-guidance": { conversationGuidance, needsFirstVisitGuidance },
      "./tool-contracts": {
        assistantReadToolDefinitions: [{ name: "get_activity_catalog", type: "function" }],
        assistantActionToolDefinitions: [{ name: "execute_booking", type: "function" }],
        assistantReadToolNames: new Set(["get_activity_catalog"]),
        assistantActionToolNames: new Set(["execute_booking"]),
      },
    },
  );
  const input = {
    supabase: db.supabase,
    studio: { id: "studio", name: "Demeter", timezone: "America/Mexico_City", currency: "MXN" },
    config: {
      assistant_name: "Demi",
      model: "test",
      reasoning_effort: "low",
      personality_instructions: "Sé breve.",
      monthly_budget_usd_micros: 100,
      conversation_budget_usd_micros: 100,
      max_model_calls_per_turn: 4,
      max_tool_calls_per_turn: 4,
    },
    conversationId: "conversation",
    turnId: "turn",
    studentId: null,
    crmContactId: null,
    activationUrl: null,
    history: [{ role: "user", content: "Sí, confirmo" }],
    testSimulation: { persona: "prospect", reservations: [], credits: 0 },
  };
  return {
    ...db,
    action,
    simulate,
    read,
    input: input as unknown as Parameters<typeof mod.runAssistantTurn>[0],
    run: mod.runAssistantTurn,
  };
}

const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 10, output_tokens: 5 },
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Demi prompt workbench", () => {
  it("validates empty and oversized prompts", () => {
    expect(validPrompt(" ")).toBe(false);
    expect(validPrompt("x".repeat(24001))).toBe(false);
    expect(validPrompt("Instrucciones claras")).toBe(true);
  });
  it("skips automatic enrollment, payment selection and confirmation actions in test mode", async () => {
    const h = orchestratorHarness();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(reply("Hola")))));
    const result = await h.run(h.input);
    expect(result.reply).toBe("Hola");
    expect(h.action).not.toHaveBeenCalled();
    expect(h.reads).not.toContain("assistant_pending_actions");
    expect(h.writes).toEqual(["assistant_model_calls"]);
  });
  it("routes model-requested booking execution to the simulator", async () => {
    const h = orchestratorHarness();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              output: [
                {
                  type: "function_call",
                  name: "execute_booking",
                  call_id: "call-1",
                  arguments: "{}",
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(reply("Listo")))),
    );
    await h.run(h.input);
    expect(h.simulate).toHaveBeenCalledOnce();
    expect(h.action).not.toHaveBeenCalled();
    expect(
      h.writes.every(
        (table) => table === "assistant_model_calls" || table === "assistant_tool_executions",
      ),
    ).toBe(true);
  });
  it("does not create real human handoffs from a test reply", async () => {
    const h = orchestratorHarness();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(reply("Voy a solicitar atención humana.")))),
    );
    await h.run(h.input);
    expect(h.action).not.toHaveBeenCalled();
    expect(h.writes).not.toContain("assistant_tool_executions");
  });
  it("uses the configured model and draft for conversations; improves without tools", async () => {
    const h = orchestratorHarness();
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(reply("Respuesta"))));
    vi.stubGlobal("fetch", fetcher);
    await h.run(h.input);
    const chatRequest = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(chatRequest.model).toBe(h.input.config.model);
    expect(chatRequest.instructions).toContain("Sé breve.");
    expect(chatRequest.instructions).toContain("MODO PRUEBA");
    await h.run({ ...h.input, improvePrompt: true });
    const improveRequest = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(improveRequest.tools).toEqual([]);
    expect(improveRequest.instructions).toContain("SOLO el prompt completo mejorado");
    expect(h.action).not.toHaveBeenCalled();
  });
  it("blocks IA requests when the budget is exhausted", async () => {
    const h = orchestratorHarness();
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      h.run({ ...h.input, config: { ...h.input.config, monthly_budget_usd_micros: 0 } }),
    ).rejects.toThrow("assistant_budget_exceeded");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("simulates booking and cancellation without writing any business table", async () => {
    const writes: string[] = [];
    const supabase = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          insert: () => {
            writes.push(table);
            throw new Error("Unexpected write");
          },
          update: () => {
            writes.push(table);
            throw new Error("Unexpected write");
          },
          maybeSingle: async () => ({
            data:
              table === "class_sessions"
                ? {
                    id: "11111111-1111-1111-1111-111111111111",
                    template_id: "template",
                    status: "scheduled",
                    starts_at: "2099-01-01T18:00:00Z",
                    ends_at: "2099-01-01T19:00:00Z",
                  }
                : { name: "Pole" },
            error: null,
          }),
        };
        return chain;
      },
    };
    const mod = serverModule<typeof import("../lib/assistant/test-simulation")>(
      "lib/assistant/test-simulation.ts",
      {
        "./action-tools": {
          isExplicitAssistantConfirmation: (message: string) => message === "Sí, confirmo",
        },
      },
    );
    const state = mod.createTestSimulation("student");
    const input = {
      state,
      supabase,
      studio: { id: "studio", timezone: "America/Mexico_City" },
      turnId: "first",
      currentUserMessage: "Quiero reservar",
    };
    const simulationInput = input as unknown as Parameters<typeof mod.simulateAssistantAction>[0];
    const prepared = await mod.simulateAssistantAction(simulationInput, "prepare_booking", {
      session_ref: "session:11111111-1111-1111-1111-111111111111",
    });
    expect(prepared.status).toBe("confirmation_required");
    const sameTurn = await mod.simulateAssistantAction(
      { ...simulationInput, currentUserMessage: "Sí, confirmo" },
      "execute_booking",
      {},
    );
    expect(sameTurn.ok).toBe(false);
    const booked = await mod.simulateAssistantAction(
      { ...simulationInput, turnId: "second", currentUserMessage: "Sí, confirmo" },
      "execute_booking",
      {},
    );
    expect(booked.ok).toBe(true);
    expect(state.credits).toBe(7);
    expect(state.reservations).toHaveLength(1);
    await mod.simulateAssistantAction(
      { ...simulationInput, turnId: "third" },
      "prepare_cancellation",
      {
        reservation_ref: state.reservations[0].reservation_ref,
        reason: "No puedo asistir",
      },
    );
    const cancelled = await mod.simulateAssistantAction(
      { ...simulationInput, turnId: "fourth", currentUserMessage: "Sí, confirmo" },
      "execute_cancellation",
      {},
    );
    expect(cancelled.ok).toBe(true);
    expect(state.credits).toBe(8);
    expect(state.reservations).toHaveLength(0);
    expect(writes).toEqual([]);
  });
});
