import { resolveEnrollmentStatus } from "../lib/assistant/enrollment-state";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationGuidance,
  needsFirstVisitGuidance,
} from "../lib/assistant/conversation-guidance";
import {
  isActiveStudentPersona,
  isFirstVisitPersona,
  testPersonaLabel,
  validPrompt,
} from "../lib/assistant/prompt-workbench";

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

function fakeDatabase(
  pendingAction: Record<string, unknown> | null = null,
  pendingPayment: Record<string, unknown> | null = null,
) {
  const writes: string[] = [];
  const reads: string[] = [];
  const supabase = {
    from(table: string) {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: () => {
          writes.push(table);
          return chain;
        },
        single: async () => ({ data: { id: "model-call" }, error: null }),
        maybeSingle: async () => ({
          data:
            table === "assistant_pending_actions"
              ? pendingAction
              : table === "demi_group_bookings"
                ? pendingPayment
                : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
  };
  return { supabase, reads, writes };
}

function orchestratorHarness(
  pendingAction: Record<string, unknown> | null = null,
  pendingPayment: Record<string, unknown> | null = null,
) {
  const action = vi.fn().mockRejectedValue(new Error("Real actions must never execute in a test"));
  const simulate = vi.fn().mockResolvedValue({ ok: true, simulated: true });
  const read = vi.fn().mockResolvedValue({ ok: true, activities: [] });
  const db = fakeDatabase(pendingAction, pendingPayment);
  const actionModule = serverModule<typeof import("../lib/assistant/action-tools")>(
    "lib/assistant/action-tools.ts",
    {
      "node:crypto": { createHash: vi.fn(), randomUUID: vi.fn() },
      "./read-tools": { getCommercialOptions: vi.fn() },
      "./group-booking": {
        groupBookingAction: vi.fn().mockRejectedValue(new Error("Unexpected group action")),
      },
    },
  );
  const mod = serverModule<typeof import("../lib/assistant/orchestrator")>(
    "lib/assistant/orchestrator.ts",
    {
      "./costs": { estimateModelCostUsdMicros: () => ({ usdMicros: 10 }) },
      "./test-simulation": { simulateAssistantAction: simulate, simulatedReadTool: () => null },
      "./action-tools": {
        executeAssistantActionTool: action,
        isExplicitAssistantConfirmation: actionModule.isExplicitAssistantConfirmation,
        parsePostTrialEnrollmentMethod: (message: string) =>
          message.toLocaleLowerCase("es-MX").includes("efectivo") ? "cash" : null,
      },
      "./read-tools": { executeAssistantReadTool: read },
      "./conversation-guidance": { conversationGuidance, needsFirstVisitGuidance },
      "./prompt-workbench": { testPersonaLabel },
      "./tool-contracts": {
        assistantReadToolDefinitions: [{ name: "get_activity_catalog", type: "function" }],
        assistantActionToolDefinitions: [
          "execute_booking",
          "prepare_transfer_package_choice",
          "prepare_bank_transfer_purchase",
          "complete_group_booking",
        ].map((name) => ({ name, type: "function" })),
        assistantReadToolNames: new Set(["get_activity_catalog"]),
        assistantActionToolNames: new Set(["execute_booking", "complete_group_booking"]),
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
    testSimulation: {
      persona: "prospect",
      identityNeedsName: true,
      reservations: [],
      credits: 0,
    },
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
  it("builds isolated lifecycle fixtures for conversational UAT", () => {
    const mod = serverModule<typeof import("../lib/assistant/test-simulation")>(
      "lib/assistant/test-simulation.ts",
      {
        "./action-tools": { isExplicitAssistantConfirmation: vi.fn() },
        "./prompt-workbench": { isActiveStudentPersona, isFirstVisitPersona },
      },
    );
    const pending = mod.createTestSimulation("trial_pending_reserved");
    const noShow = mod.createTestSimulation("trial_no_show");
    const attended = mod.createTestSimulation("trial_attended");
    const active = mod.createTestSimulation("student_reserved");
    const former = mod.createTestSimulation("former_student");
    const unknown = mod.createTestSimulation("unresolved_identity");

    expect(mod.simulatedReadTool(pending, "get_student_package_status")).toMatchObject({
      student_state: { category: "trial_pending" },
    });
    expect(mod.simulatedReadTool(noShow, "get_student_package_status")).toMatchObject({
      student_state: { category: "trial_no_show" },
    });
    expect(mod.simulatedReadTool(attended, "get_student_package_status")).toMatchObject({
      student_state: { category: "trial_attended" },
    });
    expect(mod.simulatedReadTool(active, "get_student_reservations")).toMatchObject({
      reservations: [{ reservation_ref: "reservation:test-student_reserved" }],
    });
    expect(mod.simulatedReadTool(former, "get_student_package_status")).toMatchObject({
      student_state: { category: "former_student" },
      current_package: null,
    });
    expect(mod.simulatedReadTool(unknown, "get_student_package_status")).toMatchObject({
      ok: false,
      error: "identity_required",
    });
    expect(isFirstVisitPersona("trial_cancelled")).toBe(true);
    expect(isActiveStudentPersona("student_reserved")).toBe(true);
    expect(testPersonaLabel("unresolved_identity")).toContain("identidad resuelta");
  });

  it("validates empty and oversized prompts", () => {
    expect(validPrompt(" ")).toBe(false);
    expect(validPrompt("x".repeat(24001))).toBe(false);
    expect(validPrompt("Instrucciones claras")).toBe(true);
  });
  it("recognizes natural explicit booking confirmations without accepting questions", () => {
    const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
      "lib/assistant/action-tools.ts",
      {
        "node:crypto": { createHash: vi.fn(), randomUUID: vi.fn() },
        "./read-tools": { getCommercialOptions: vi.fn() },
        "./group-booking": {
          groupBookingAction: vi.fn().mockRejectedValue(new Error("Unexpected group action")),
        },
      },
    );

    expect(mod.isExplicitAssistantConfirmation("Sí, confirmo.")).toBe(true);
    expect(mod.isExplicitAssistantConfirmation("Sí, prepárame los datos para transferir.")).toBe(
      true,
    );
    expect(mod.isExplicitAssistantConfirmation("No, prepárame los datos para transferir.")).toBe(
      false,
    );
    expect(mod.isExplicitAssistantConfirmation("¿Sí, prepárame los datos para transferir?")).toBe(
      false,
    );
    expect(mod.isExplicitAssistantConfirmation("Confirmo")).toBe(true);
    expect(mod.isExplicitAssistantConfirmation("Sí, cancélala.")).toBe(true);
    expect(mod.isExplicitAssistantConfirmation("Sí, reagéndala.")).toBe(true);
    expect(mod.isExplicitAssistantConfirmation("¿Sí, confirmo?")).toBe(false);
    expect(mod.isExplicitAssistantConfirmation("Gracias")).toBe(false);
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
  it.each([
    { status: "provisional", reserved_count: 1, payment_validation_required: true, expected: true },
    { status: "partial", reserved_count: 1, payment_validation_required: true, expected: true },
    { status: "validated", reserved_count: 1, payment_validation_required: false, expected: false },
    { status: "partial", reserved_count: 0, payment_validation_required: true, expected: false },
  ])(
    "adds a revocation notice only for actual provisional transfer reservations ($status/$reserved_count)",
    async (result) => {
      const h = orchestratorHarness();
      h.simulate.mockResolvedValue({ ok: result.status !== "partial", ...result });
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
                    name: "complete_group_booking",
                    call_id: "call-1",
                    arguments: "{}",
                  },
                ],
              }),
            ),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify(reply("Resultado registrado.")))),
      );
      const outcome = await h.run(h.input);
      expect(outcome.reply.includes("pueden cancelarse si no se valida")).toBe(result.expected);
    },
  );
  it.each([
    "El pago sigue pendiente de validación. La reserva podría cancelarse si la transferencia no se confirma correctamente.",
    "Si la transferencia no se confirma correctamente, la reserva podría cancelarse.",
  ])("does not repeat a complete revocation notice: %s", async (text) => {
    const h = orchestratorHarness();
    h.simulate.mockResolvedValue({
      ok: true,
      status: "provisional",
      reserved_count: 1,
      payment_validation_required: true,
    });
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
                  name: "complete_group_booking",
                  call_id: "call-1",
                  arguments: "{}",
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(reply(text)))),
    );
    expect((await h.run(h.input)).reply).toBe(text);
  });
  it("executes a pending simulated action on one explicit confirmation", async () => {
    const h = orchestratorHarness();
    const summary = {
      activity: "Pole Fitness",
      date: "2099-01-01",
      starts_at_local: "12:00",
      ends_at_local: "13:00",
    };
    h.input.testSimulation!.pending = {
      tool: "execute_booking",
      summary,
      preparedTurnId: "previous-turn",
    };
    h.simulate.mockResolvedValue({ ok: true, simulated: true, status: "executed", summary });

    const result = await h.run(h.input);

    expect(result.reply).toContain("Tu reserva de Pole Fitness quedó confirmada");
    expect(h.simulate).toHaveBeenCalledOnce();
    expect(h.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn", currentUserMessage: "Sí, confirmo" }),
      "execute_booking",
      {},
    );
    expect(h.action).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("does not confirm a prospect reservation before a simulated transfer is paid", async () => {
    const h = orchestratorHarness();
    const summary = {
      activity: "Pole Fitness",
      date: "2099-01-01",
      starts_at_local: "12:00",
      ends_at_local: "13:00",
      trial_booking: true,
      payment_before_booking: true,
      amount_minor: 15000,
      currency: "MXN",
    };
    h.input.testSimulation!.pending = {
      tool: "execute_booking",
      summary,
      preparedTurnId: "previous-turn",
    };
    h.simulate.mockResolvedValue({
      ok: true,
      simulated: true,
      status: "payment_required",
      reservation_confirmed: false,
      amount_minor: 15000,
      currency: "MXN",
      bank_details: {
        bank_name: "Banco de prueba",
        account_holder: "Titular de prueba",
        clabe: "CLABE_DE_PRUEBA",
      },
      summary,
    });

    const result = await h.run(h.input);

    expect(result.reply).toContain("primero realiza la transferencia");
    expect(result.reply).toContain("CLABE: CLABE_DE_PRUEBA");
    expect(result.reply).toContain("Envíame el comprobante por este mismo chat");
    expect(result.reply).toContain("no se generó un pago ni se creó una reserva");
    expect(result.reply).not.toContain("quedó confirmada");
    expect(h.simulate).toHaveBeenCalledOnce();
    expect(h.action).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("executes a real pending booking on the first 'Sí, confirmo' without another model turn", async () => {
    const summary = {
      activity: "Pole Fitness",
      date: "2099-01-01",
      starts_at_local: "12:00",
      ends_at_local: "13:00",
    };
    const h = orchestratorHarness({
      id: "pending-action",
      action_type: "booking.create",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    h.input.testSimulation = undefined;
    h.action.mockResolvedValue({ ok: true, status: "executed", summary });

    const result = await h.run(h.input);

    expect(result.reply).toContain("Tu reserva de Pole Fitness quedó confirmada");
    expect(h.action).toHaveBeenCalledOnce();
    expect(h.action).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserMessage: "Sí, confirmo" }),
      "execute_booking",
      {},
    );
    expect(h.simulate).not.toHaveBeenCalled();
    expect(h.writes).toEqual(["assistant_tool_executions"]);
  });
  it("does not ask for a second confirmation after a simulated cancellation executes", async () => {
    const h = orchestratorHarness();
    const summary = {
      activity: "Pole Fitness",
      date: "2099-01-01",
      starts_at_local: "12:00",
      ends_at_local: "13:00",
      credit_will_return: true,
    };
    h.input.testSimulation!.pending = {
      tool: "execute_cancellation",
      summary,
      preparedTurnId: "previous-turn",
    };
    h.simulate.mockResolvedValue({ ok: true, simulated: true, status: "executed", summary });

    const result = await h.run(h.input);

    expect(result.reply).toContain("Listo. Cancelé tu reserva de Pole Fitness");
    expect(result.reply).toContain("El crédito regresó a tu cuenta.");
    expect(result.reply).not.toContain("¿Confirmas");
    expect(h.simulate).toHaveBeenCalledOnce();
    expect(h.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn", currentUserMessage: "Sí, confirmo" }),
      "execute_cancellation",
      {},
    );
    expect(h.action).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
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
  it.each([null, "student"])(
    "advertises package transfer only with a student identity (%s)",
    async (studentId) => {
      const h = orchestratorHarness();
      vi.stubEnv("OPENAI_API_KEY", "test");
      const fetcher = vi
        .fn()
        .mockImplementation(async () => new Response(JSON.stringify(reply("Respuesta"))));
      vi.stubGlobal("fetch", fetcher);
      await h.run({
        ...h.input,
        studentId,
        testSimulation: undefined,
        history: [{ role: "user", content: "Quiero primera clase por transferencia" }],
      });
      const request = JSON.parse(fetcher.mock.calls[0][1].body);
      const names = request.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("execute_booking");
      for (const name of ["prepare_transfer_package_choice", "prepare_bank_transfer_purchase"])
        expect(names.includes(name)).toBe(Boolean(studentId));
    },
  );
  it.each(["awaiting_receipt", "awaiting_participants", "provisional", "validated"])(
    "restores the persisted payment reference across user messages (status=%s)",
    async (status) => {
      const receiptReceived = status !== "awaiting_receipt";
      const h = orchestratorHarness(null, {
        id: "persisted-group",
        status,
        session_id: "session",
        participant_count: 1,
        amount_minor: 15000,
        currency: "MXN",
        receipt_event_id: receiptReceived ? "event" : null,
        resource_id: null,
      });
      vi.stubEnv("OPENAI_API_KEY", "test");
      const fetcher = vi
        .fn()
        .mockImplementation(async () => new Response(JSON.stringify(reply("Respuesta"))));
      vi.stubGlobal("fetch", fetcher);
      await h.run({
        ...h.input,
        serviceMode: true,
        testSimulation: undefined,
        history: [{ role: "user", content: "Mis datos son UAT Persona, celular 9990000001" }],
      });
      const request = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(request.instructions).toContain('"group_id":"persisted-group"');
      expect(request.instructions).toContain(`"receipt_received":${receiptReceived}`);
      expect(request.instructions).toContain("leído del estudio y esta conversación");
      expect(request.instructions).toContain("complete_group_booking");
    },
  );
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
        "./prompt-workbench": { isActiveStudentPersona, isFirstVisitPersona },
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
    const duplicateBookingConfirmation = await mod.simulateAssistantAction(
      { ...simulationInput, turnId: "duplicate", currentUserMessage: "Sí, confirmo" },
      "execute_booking",
      {},
    );
    expect(duplicateBookingConfirmation.ok).toBe(false);
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

  it("blocks a second simulated trial booking while one remains active", async () => {
    const mod = serverModule<typeof import("../lib/assistant/test-simulation")>(
      "lib/assistant/test-simulation.ts",
      {
        "./action-tools": { isExplicitAssistantConfirmation: vi.fn() },
        "./prompt-workbench": { isActiveStudentPersona, isFirstVisitPersona },
      },
    );
    const state = mod.createTestSimulation("trial_pending_reserved");
    const input = {
      state,
      supabase: {
        from: () => {
          throw new Error("Existing booking must block a second preparation");
        },
      },
      studio: { id: "studio", timezone: "America/Mexico_City" },
      turnId: "second-booking",
      currentUserMessage: "Quiero reservar otra clase",
    } as unknown as Parameters<typeof mod.simulateAssistantAction>[0];

    expect(
      await mod.simulateAssistantAction(input, "prepare_booking", {
        session_ref: "session:11111111-1111-1111-1111-111111111111",
      }),
    ).toMatchObject({ ok: false, reason_code: "trial_reservation_exists", simulated: true });
  });

  it("requires a new prospect to confirm a full name before simulated booking", async () => {
    const mod = serverModule<typeof import("../lib/assistant/test-simulation")>(
      "lib/assistant/test-simulation.ts",
      {
        "./action-tools": {
          isExplicitAssistantConfirmation: (message: string) => message === "Sí, confirmo",
        },
        "./prompt-workbench": { isActiveStudentPersona, isFirstVisitPersona },
      },
    );
    const state = mod.createTestSimulation("prospect");
    const input = {
      state,
      supabase: {
        from: () => {
          throw new Error("Name gate should run before database reads");
        },
      },
      studio: { id: "studio", timezone: "America/Mexico_City" },
      turnId: "first",
      currentUserMessage: "La opción 2, por favor",
    } as unknown as Parameters<typeof mod.simulateAssistantAction>[0];

    expect(state.identityNeedsName).toBe(true);
    expect(
      await mod.simulateAssistantAction(input, "prepare_booking", {
        session_ref: "session:11111111-1111-1111-1111-111111111111",
      }),
    ).toMatchObject({ ok: false, reason_code: "prospect_name_required", simulated: true });

    expect(mod.confirmSimulatedProspectName(state, "La opción 2, por favor")).toBe(false);
    expect(mod.confirmSimulatedProspectName(state, "Me llamo Andrea López")).toBe(true);
    expect(state.identityNeedsName).toBe(false);

    const combinedMessageState = mod.createTestSimulation("prospect");
    expect(
      mod.confirmSimulatedProspectName(
        combinedMessageState,
        "Me llamo Valeria Demo y sí quiero reservar esa clase.",
      ),
    ).toBe(true);
    expect(combinedMessageState.identityNeedsName).toBe(false);
  });

  it("keeps a prospect trial reservation pending until transfer when Sandbox policy requires prepayment", async () => {
    const writes: string[] = [];
    const reads: string[] = [];
    const supabase = {
      from: (table: string) => {
        reads.push(table);
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
                : table === "class_templates"
                  ? { name: "Pole Fitness", drop_in_price_minor: 15000 }
                  : table === "studio_bank_transfer_settings"
                    ? {
                        bank_name: "Banco de prueba",
                        account_holder: "Titular de prueba",
                        clabe: "CLABE_DE_PRUEBA",
                        account_number: null,
                        card_number: null,
                        instructions: "Usa tu nombre como concepto.",
                      }
                    : null,
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
        "./prompt-workbench": { isActiveStudentPersona, isFirstVisitPersona },
      },
    );
    const state = mod.createTestSimulation("prospect");
    state.identityNeedsName = false;
    state.paymentBeforeBooking = true;
    const input = {
      state,
      supabase,
      studio: { id: "studio", timezone: "America/Mexico_City", currency: "MXN" },
      turnId: "prepare-turn",
      currentUserMessage: "Quiero reservar",
    } as unknown as Parameters<typeof mod.simulateAssistantAction>[0];

    const prepared = await mod.simulateAssistantAction(input, "prepare_booking", {
      session_ref: "session:11111111-1111-1111-1111-111111111111",
    });
    expect(prepared).toMatchObject({
      ok: true,
      simulated: true,
      status: "confirmation_required",
      summary: { trial_booking: true, payment_before_booking: true, amount_minor: 15000 },
    });

    const afterConfirmation = await mod.simulateAssistantAction(
      { ...input, turnId: "confirm-turn", currentUserMessage: "Sí, confirmo" },
      "execute_booking",
      {},
    );
    expect(afterConfirmation).toMatchObject({
      ok: true,
      simulated: true,
      status: "payment_required",
      reservation_confirmed: false,
      bank_details: {
        bank_name: "Banco de prueba",
        account_holder: "Titular de prueba",
        clabe: "CLABE_DE_PRUEBA",
      },
    });
    expect(state.reservations).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(reads).toContain("studio_bank_transfer_settings");
  });
});

describe("Demi shared commercial price", () => {
  it.each([15000, 0, null])("returns class price %s without requiring a package", async (price) => {
    const mod = serverModule<typeof import("../lib/assistant/read-tools")>(
      "lib/assistant/read-tools.ts",
      { "./enrollment-state": { resolveEnrollmentStatus } },
    );
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const scopes: string[] = [];
    const supabase = {
      from: (table: string) => {
        const response = {
          data:
            table === "class_sessions"
              ? { id: sessionId, template_id: "template", recurring_schedule_id: null }
              : table === "class_templates"
                ? {
                    id: "template",
                    name: "Pole Fitness",
                    discipline_id: "discipline",
                    drop_in_price_minor: price,
                  }
                : [],
          error: null,
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (key: string, value: string) => {
            if (key === "studio_id") scopes.push(value);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => response,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
        };
        return chain;
      },
    };
    const result = await mod.getCommercialOptions(
      {
        supabase,
        studio: { id: "studio", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
      } as unknown as import("../lib/assistant/read-tools").AssistantToolContext,
      { session_ref: `session:${sessionId}` },
    );
    expect(result).toMatchObject({
      ok: true,
      options: [],
      single_class: price == null ? null : { price_minor: price, currency: "MXN" },
    });
    expect(scopes).toEqual(["studio", "studio", "studio", "studio"]);
  });
});

describe("cash purchases require a separate explicit confirmation", () => {
  it("recognizes a natural cash purchase confirmation", () => {
    const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
      "lib/assistant/action-tools.ts",
      { "node:crypto": {}, "./read-tools": {}, "./group-booking": {} },
    );
    expect(
      mod.isExplicitAssistantConfirmation("Sí, confirmo la compra del paquete en efectivo."),
    ).toBe(true);
  });
  for (const [label, message, preparedTurn] of [
    ["questions", "¿Sí puedo pagar después?", "previous"],
    ["negative confirmation", "No confirmo la compra", "previous"],
    ["preparation and execution in one turn", "Sí, confirmo", "current"],
  ]) {
    it(`blocks ${label} without creating a sale`, async () => {
      const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
        "lib/assistant/action-tools.ts",
        { "node:crypto": {}, "./read-tools": {}, "./group-booking": {} },
      );
      const rpc = vi.fn();
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "in", "order", "limit"]) chain[name] = () => chain;
      chain.maybeSingle = async () => ({
        data: {
          id: "pending",
          status: "pending",
          expires_at: new Date(Date.now() + 60000).toISOString(),
          action_payload: { student_id: "student", prepared_turn_id: preparedTurn },
        },
        error: null,
      });
      const result = await mod.executeAssistantActionTool(
        {
          supabase: { from: () => chain, rpc } as never,
          studio: { id: "studio" } as never,
          conversationId: "conversation",
          turnId: "current",
          studentId: "student",
          crmContactId: null,
          activationUrl: null,
          serviceMode: true,
          currentUserMessage: message,
        },
        "confirm_cash_package_purchase",
        {},
      );
      expect(result).toMatchObject({ ok: false });
      expect(rpc).not.toHaveBeenCalled();
    });
  }
});

describe("handoff reasons match configured operational policies", () => {
  it.each([
    { requested: "user_requested_human", canonical: "human_requested", enabled: true },
    { requested: "refund_request", canonical: "refund_request", enabled: true },
    { requested: "human_requested", canonical: "human_requested", enabled: false },
  ])("uses $canonical and respects its enabled flag", async ({ requested, canonical, enabled }) => {
    const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
      "lib/assistant/action-tools.ts",
      { "node:crypto": {}, "./read-tools": {}, "./group-booking": {} },
    );
    const eq = vi.fn();
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (...args: unknown[]) => {
      eq(...args);
      return chain;
    };
    chain.maybeSingle = async () => ({
      data: { reason_code: canonical, enabled, blocking: true },
      error: null,
    });
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const result = await mod.executeAssistantActionTool(
      {
        supabase: { from: () => chain, rpc } as never,
        studio: { id: "studio" } as never,
        conversationId: "conversation",
        turnId: "turn",
        studentId: "student",
        crmContactId: null,
        activationUrl: null,
        serviceMode: true,
        currentUserMessage: "Quiero atención humana",
      },
      "escalate_to_human",
      { reason_code: requested, note: "Solicitud de prueba" },
    );
    expect(eq).toHaveBeenCalledWith("reason_code", canonical);
    if (enabled) {
      expect(result).toMatchObject({ ok: true, reason_code: canonical });
      expect(rpc).toHaveBeenCalledWith(
        "assistant_create_handoff",
        expect.objectContaining({ target_reason_code: canonical }),
      );
    } else {
      expect(result).toMatchObject({ ok: false });
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});
