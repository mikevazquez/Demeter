import { firstClassPaymentInstructions } from "../lib/assistant/first-class-payment-instructions";
import {
  isMixedInformationActionRequest,
  shouldBlockPaymentForInformation,
} from "../lib/assistant/information-intent";
import { resolveEnrollmentStatus } from "../lib/assistant/enrollment-state";
import * as temporaryInformation from "../lib/assistant/temporary-information";
import * as conversationContext from "../lib/assistant/conversation-context";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationGuidance,
  explanationTurnGuidance,
  needsFirstVisitGuidance,
  prospectCashTurnGuidance,
  prospectCashTurnReply,
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
  transferPurchase: Record<string, unknown> | null = null,
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
                : table === "assistant_transfer_purchase_intents"
                  ? transferPurchase
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
  transferPurchase: Record<string, unknown> | null = null,
) {
  const action = vi.fn().mockRejectedValue(new Error("Real actions must never execute in a test"));
  const simulate = vi.fn().mockResolvedValue({ ok: true, simulated: true });
  const simulatedRead = vi.fn<(state: unknown, name: string) => unknown>(() => null);
  const read = vi.fn().mockResolvedValue({ ok: true, activities: [] });
  const db = fakeDatabase(pendingAction, pendingPayment, transferPurchase);
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
      "./test-simulation": { simulateAssistantAction: simulate, simulatedReadTool: simulatedRead },
      "./action-tools": {
        executeAssistantActionTool: action,
        isExplicitAssistantConfirmation: actionModule.isExplicitAssistantConfirmation,
        isExplicitCashPurchaseConfirmation: actionModule.isExplicitCashPurchaseConfirmation,
        parsePostTrialEnrollmentMethod: (message: string) =>
          message.toLocaleLowerCase("es-MX").includes("efectivo") ? "cash" : null,
      },
      "./read-tools": { executeAssistantReadTool: read },
      "./conversation-guidance": {
        conversationGuidance,
        explanationTurnGuidance,
        needsFirstVisitGuidance,
        prospectCashTurnGuidance,
        prospectCashTurnReply,
      },
      "./conversation-context": conversationContext,
      "./prompt-workbench": { testPersonaLabel },
      "./first-class-payment-instructions": { firstClassPaymentInstructions },
      "./information-intent": { isMixedInformationActionRequest, shouldBlockPaymentForInformation },
      "./tool-contracts": {
        assistantReadToolDefinitions: [{ name: "get_activity_catalog", type: "function" }],
        assistantActionToolDefinitions: [
          "execute_booking",
          "prepare_first_class_payment",
          "prepare_transfer_package_choice",
          "prepare_bank_transfer_purchase",
          "complete_purchase_profile",
          "complete_group_booking",
          "update_contact_followup",
        ].map((name) => ({ name, type: "function" })),
        assistantReadToolNames: new Set(["get_activity_catalog"]),
        assistantActionToolNames: new Set([
          "prepare_first_class_payment",
          "execute_booking",
          "complete_group_booking",
          "prepare_student_access_activation",
          "prepare_bank_transfer_purchase",
          "complete_purchase_profile",
          "update_contact_followup",
        ]),
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
    simulatedRead,
    read,
    input: input as unknown as Parameters<typeof mod.runAssistantTurn>[0],
    run: mod.runAssistantTurn,
  };
}

const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("F01 server confirmation routes", () => {
  const summary = {
    date: "2026-10-22",
    starts_at_local: "18:00",
    commercial_status: "package_covered",
  };
  const message = "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete.";
  it("confirms a matching booking without consulting the model or preparing again", async () => {
    const h = orchestratorHarness({
      id: "pending",
      action_type: "booking.create",
      confirmation_summary: summary,
    });
    h.input.testSimulation = undefined;
    h.input.history = [{ role: "user", content: message }];
    h.action.mockResolvedValue({ ok: true, status: "executed", summary });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await h.run(h.input);
    expect(h.action).toHaveBeenCalledOnce();
    expect(h.action).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserMessage: message }),
      "execute_booking",
      {},
    );
    expect(result.reply).toContain("confirmada");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "booking.cancel",
    "booking.reschedule",
    "waitlist.join",
    "commerce.cash_purchase",
    "account.activate",
  ])("does not route booking details to pending %s", async (action_type) => {
    const h = orchestratorHarness({ id: "pending", action_type, confirmation_summary: summary });
    h.input.testSimulation = undefined;
    h.input.history = [{ role: "user", content: message }];
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(reply("Revisemos la reserva.")))),
    );
    await h.run(h.input);
    expect(h.action).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Demi prompt workbench", () => {
  it.each([
    ["standard", true],
    ["S11", false],
    ["S12", false],
    ["S13", false],
    ["S14", false],
    ["S15", false],
  ] as const)(
    "keeps transfer-choice availability consistent with fixture %s",
    async (workbenchCase, offered) => {
      const h = orchestratorHarness();
      h.input.testSimulation!.workbenchCase = workbenchCase;
      h.input.history = [
        { role: "user", content: "Quiero el paquete de ocho clases por transferencia." },
      ];
      vi.stubEnv("OPENAI_API_KEY", "test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(
            body.tools.some(
              (tool: { name: string }) => tool.name === "prepare_transfer_package_choice",
            ),
          ).toBe(offered);
          expect(
            body.tools.some(
              (tool: { name: string }) => tool.name === "prepare_bank_transfer_purchase",
            ),
          ).toBe(true);
          return new Response(JSON.stringify(reply("Revisemos el paquete elegido.")));
        }),
      );
      await h.run(h.input);
      expect(h.action).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["student", false],
    ["former_student", false],
    ["prospect", true],
    ["trial_pending_reserved", true],
  ] as const)(
    "offers simulated follow-up only for applicable persona %s",
    async (persona, allowed) => {
      const h = orchestratorHarness();
      h.input.testSimulation!.persona = persona;
      h.input.history = [
        { role: "user", content: "Quiero el paquete de ocho clases por transferencia." },
      ];
      vi.stubEnv("OPENAI_API_KEY", "test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(
            body.tools.some((tool: { name: string }) => tool.name === "update_contact_followup"),
          ).toBe(allowed);
          return new Response(JSON.stringify(reply("Revisemos las opciones del paquete.")));
        }),
      );
      await h.run(h.input);
      expect(h.action).not.toHaveBeenCalled();
      expect(h.simulate).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "executes the real orchestrator action barrier after generation (current=%s)",
    async (current) => {
      const h = orchestratorHarness();
      h.input.testSimulation = undefined;
      h.input.history = [{ role: "user", content: "Sí, reserva la clase elegida." }];
      let turnCurrent = true;
      h.input.isTurnCurrent = vi.fn(async () => turnCurrent);
      h.action.mockResolvedValue({ ok: true });
      vi.stubEnv("OPENAI_API_KEY", "test");
      let releaseModel!: (response: Response) => void;
      const modelPending = new Promise<Response>((resolve) => {
        releaseModel = resolve;
      });
      const fetcher = vi
        .fn()
        .mockReturnValueOnce(modelPending)
        .mockResolvedValueOnce(new Response(JSON.stringify(reply("Resultado sintético."))));
      vi.stubGlobal("fetch", fetcher);
      const pending = h.run(h.input);
      // Attach the rejection assertion before resolving the model to avoid unhandled rejection.
      const assertion = current
        ? expect(pending).resolves.toMatchObject({ reply: "Resultado sintético." })
        : expect(pending).rejects.toThrow("assistant_turn_superseded");
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      turnCurrent = current;
      releaseModel(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "execute_booking",
                call_id: "delayed-action",
                arguments: "{}",
              },
            ],
          }),
        ),
      );
      await assertion;
      expect(h.input.isTurnCurrent).toHaveBeenCalledOnce();
      expect(h.action).toHaveBeenCalledTimes(current ? 1 : 0);
      expect(h.simulate).not.toHaveBeenCalled();
      expect(
        h.writes.every((table) =>
          ["assistant_model_calls", "assistant_tool_executions"].includes(table),
        ),
      ).toBe(true);
    },
  );

  it.each(["booking.create", "booking.cancel", "booking.reschedule", "commerce.cash_purchase"])(
    "rejects a superseded server confirmation before %s can execute",
    async (action_type) => {
      const h = orchestratorHarness({ id: "pending-action", action_type });
      h.input.testSimulation = undefined;
      h.input.isTurnCurrent = vi.fn(async () => false);
      vi.stubEnv("OPENAI_API_KEY", "test");
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(h.run(h.input)).rejects.toThrow("assistant_turn_superseded");
      expect(h.action).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["Hola", "Gracias.", "Entendido"])(
    "preserves stored memory for social message %s even if the model returns a replacement",
    async (message) => {
      const save = vi.spyOn(conversationContext, "saveConversationMemory");
      try {
        const h = orchestratorHarness();
        h.input.history = [{ role: "user", content: message }];
        vi.stubEnv("OPENAI_API_KEY", "test");
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            expect(body.text).toBeUndefined();
            expect(body.tools).toEqual([]);
            return new Response(
              JSON.stringify(
                reply(
                  JSON.stringify({
                    reply: "Con gusto.",
                    memory: {
                      intent: null,
                      activity: null,
                      availability: null,
                      selected_option: null,
                      next_step: null,
                    },
                  }),
                ),
              ),
            );
          }),
        );
        expect((await h.run(h.input)).reply).toBe("Con gusto.");
        expect(save).not.toHaveBeenCalled();
        expect(h.action).not.toHaveBeenCalled();
        expect(h.simulate).not.toHaveBeenCalled();
      } finally {
        save.mockRestore();
      }
    },
  );

  it.each([
    ["gpt-5.6-luna", "low"],
    ["gpt-4.1", undefined],
  ])("retains structured memory for preference changes on %s", async (model, verbosity) => {
    const h = orchestratorHarness();
    h.input.config.model = model!;
    h.input.history = [{ role: "user", content: "Ahora sólo puedo los viernes a las 18:00." }];
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.text.format.name).toBe("demi_conversation_reply");
        expect(body.text.verbosity).toBe(verbosity);
        expect(body.instructions).toContain("aplica correcciones recientes");
        return new Response(JSON.stringify(reply("Revisamos los viernes.")));
      }),
    );
    expect((await h.run(h.input)).reply).toBe("Revisamos los viernes.");
  });

  it.each([
    [{ closed_first_class: true }, "PENDIENTES CERRADOS", "hola"],
    [
      { purchase_status: "awaiting_profile", purchase: { total_amount_minor: 80000 } },
      "COMPROBANTE RECIBIDO, PERFIL PENDIENTE",
      "¿Qué sigue?",
    ],
    [
      { purchase_status: "awaiting_receipt", purchase: { total_amount_minor: 49900 } },
      "COMPRA PENDIENTE DE COMPROBANTE",
      "Ya pagué",
    ],
    [
      { purchase_status: "provisional_active", purchase: { total_amount_minor: 80000 } },
      "COMPROBANTE RECIBIDO Y PAQUETE ACTIVO PROVISIONALMENTE",
      "Envío el comprobante de prueba por el monto acordado.",
    ],
  ])(
    "passes simulated current payment context to the model without operational reads",
    async (context, marker, message) => {
      const h = orchestratorHarness();
      h.input.history = [{ role: "user", content: message }];
      h.simulatedRead.mockImplementation((_state, name) =>
        name === "get_student_package_status"
          ? { ok: true, student_state: { category: "prospect" }, workbench_context: context }
          : { ok: true, reservations: [] },
      );
      vi.stubEnv("OPENAI_API_KEY", "test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.instructions).toContain(marker);
          if ("purchase_status" in context && context.purchase_status === "awaiting_profile") {
            expect(body.instructions).toContain(
              "El paquete y la inscripción todavía no están activos",
            );
            expect(body.instructions).toContain("Sólo un resultado provisional_active");
          }
          if (message === "hola") expect(body.tools).toEqual([]);
          return new Response(JSON.stringify(reply("Respuesta sintética, no UAT del modelo.")));
        }),
      );
      await h.run(h.input);
      expect(h.read).not.toHaveBeenCalled();
      expect(h.action).not.toHaveBeenCalled();
      expect(h.reads).not.toContain("assistant_transfer_purchase_intents");
      expect(h.reads).not.toContain("demi_group_bookings");
    },
  );

  it.each(["prepare_bank_transfer_purchase", "complete_purchase_profile"])(
    "intercepts %s before its real executor",
    async (name) => {
      const h = orchestratorHarness();
      h.input.history = [{ role: "user", content: "Quiero continuar con el paquete elegido." }];
      h.simulate.mockResolvedValue({ ok: false, simulated: true, reason_code: "fixture_test" });
      vi.stubEnv("OPENAI_API_KEY", "test");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                output: [{ type: "function_call", name, call_id: "fixture", arguments: "{}" }],
              }),
            ),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify(reply("Seguimos con la prueba.")))),
      );
      await h.run(h.input);
      expect(h.simulate).toHaveBeenCalledOnce();
      expect(h.action).not.toHaveBeenCalled();
    },
  );

  it("loads current rights and reservations before responding to a greeting", async () => {
    const h = orchestratorHarness();
    h.input.testSimulation = undefined;
    h.input.studentId = "verified-student";
    h.input.studentCategory = "trial_pending";
    h.input.history = [{ role: "user", content: "Hola" }];
    h.read.mockImplementation(async (_ctx, name) =>
      name === "get_student_package_status"
        ? {
            ok: true,
            student_state: { category: "student", enrollment_status: "active" },
            current_package: { available_credits: 8 },
          }
        : { ok: true, reservations: [] },
    );
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetcher = vi.fn(async (_url, init) => {
      expect(h.read).toHaveBeenCalledTimes(2);
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toContain('"available_credits":8');
      expect(body.instructions).toContain("Para alumnas, resuelve primero su solicitud concreta");
      expect(body.text).toBeUndefined();
      expect(body.instructions).toContain("La memoria existente se conserva automáticamente");
      expect(body.tools).toEqual([]);
      return new Response(
        JSON.stringify(
          reply(
            JSON.stringify({
              reply: "¡Hola! ¿Te ayudo a reservar?",
              memory: {
                intent: null,
                activity: null,
                availability: null,
                selected_option: null,
                next_step: null,
              },
            }),
          ),
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await h.run(h.input);
    expect(result.reply).toBe("¡Hola! ¿Te ayudo a reservar?");
    expect(result.reply).not.toContain("memory");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(h.action).not.toHaveBeenCalled();
  });

  it("keeps a failed initial rights lookup unknown instead of using a stale lifecycle", async () => {
    const h = orchestratorHarness();
    h.input.testSimulation = undefined;
    h.input.studentId = "verified-student";
    h.input.studentCategory = "trial_pending";
    h.input.history = [{ role: "user", content: "Hola" }];
    h.read.mockRejectedValue(new Error("unavailable"));
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.instructions).toContain("context_unavailable");
        expect(body.instructions).toContain("no pudo determinar su etapa actual");
        return new Response(JSON.stringify(reply("Hola, ¿en qué te ayudo?")));
      }),
    );
    expect((await h.run(h.input)).reply).toBe("Hola, ¿en qué te ayudo?");
    expect(h.action).not.toHaveBeenCalled();
  });

  it("never authorizes a payment action from a greeting, even if a model requests it", async () => {
    const h = orchestratorHarness();
    h.input.history = [{ role: "user", content: "Hola" }];
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
                  name: "prepare_first_class_payment",
                  call_id: "unrequested",
                  arguments: "{}",
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(reply("Hola, ¿necesitas ayuda con el pago?"))),
        ),
    );
    const result = await h.run(h.input);
    expect(h.action).not.toHaveBeenCalled();
    expect(h.simulate).not.toHaveBeenCalled();
    expect(result.trace.toolCalls).toContainEqual({
      name: "prepare_first_class_payment",
      status: "blocked",
    });
  });

  it.each([false, true])("blocks actions during payment objection (second=%s)", async (second) => {
    const h = orchestratorHarness();
    h.input.history = [
      { role: "assistant", content: "El anticipo asegura tu primera clase." },
      { role: "user", content: "¿Puedo pagar en efectivo?" },
      ...(second
        ? [
            { role: "assistant" as const, content: "Para asegurar lugar se necesita anticipo." },
            { role: "user" as const, content: "No gracias, sólo puedo en efectivo." },
          ]
        : []),
    ];
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetcher = vi.fn().mockRejectedValue(new Error("Payment objections need no model call"));
    vi.stubGlobal("fetch", fetcher);
    const result = await h.run(h.input);
    expect(h.action).not.toHaveBeenCalled();
    expect(h.simulate).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.trace.toolCalls).toEqual([]);
    expect(result.reply).toContain(second ? "únicamente si hay lugar" : "pago por adelantado");
    expect(result.reply).toContain(second ? "recepción recibe y registra el pago" : "Sin ese pago");
  });

  it("answers a mixed information request while retaining exact payment instructions", async () => {
    const h = orchestratorHarness();
    h.input.history = [{ role: "user", content: "¿Dónde están? También quiero reservar." }];
    h.simulate.mockResolvedValue({
      ok: true,
      status: "payment_required",
      amount_minor: 15000,
      currency: "MXN",
      bank_details: { bank_name: "Banco de prueba", account_number: "0000" },
    });
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "prepare_first_class_payment",
                call_id: "payment",
                arguments: "{}",
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(reply("Estamos en la dirección consultada."))),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await h.run(h.input);
    expect(result.reply).toContain("Estamos en la dirección consultada.");
    expect(result.reply).toContain("Cuenta: 0000");
    expect(result.reply).toContain("Todavía no hay una reserva confirmada");
    expect(h.simulate).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
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
  it("asks to confirm prepared access even when enrollment is still unpaid", async () => {
    const h = orchestratorHarness();
    h.simulate.mockResolvedValue({
      ok: true,
      status: "confirmation_required",
      summary: { post_trial: true, enrollment_required: true },
    });
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "function_call",
              name: "prepare_student_access_activation",
              call_id: "access-1",
              arguments: "{}",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await h.run(h.input);
    expect(result.reply).toContain("¿Confirmas que active tu acceso?");
    expect(result.reply).not.toContain("inscripción");
    expect(fetchMock).toHaveBeenCalledOnce();
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
  it.each([
    { ok: false, error: "booking_execution_failed", outcome_unknown: true },
    { ok: false, error: "booking_reconciliation_unavailable" },
    {
      ok: false,
      error: "booking_execution_failed",
      human_review_created: true,
      handoff_id: "handoff",
    },
  ])("does not claim no changes when the booking outcome is unknown: %j", async (failure) => {
    const h = orchestratorHarness({
      id: "pending-action",
      action_type: "booking.create",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    h.input.testSimulation = undefined;
    h.action.mockResolvedValue(failure);
    const result = await h.run(h.input);
    expect(result.reply).toContain("No pude confirmar el resultado");
    expect(result.reply).not.toContain("No se hizo ningún cambio");
    if ("human_review_created" in failure) expect(result.reply).toContain("Creé una solicitud");
    else expect(result.reply).not.toContain("Creé una solicitud");
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
      {
        "./enrollment-state": { resolveEnrollmentStatus },
        "./temporary-information": temporaryInformation,
        "./runtime-config": {
          loadDemiRuntimeConfig: () => {
            throw new Error("Unexpected configuration read in commercial price test");
          },
        },
        "./class-preparation": { preparationFromStudioPrompt: () => null },
      },
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

describe("current package transfer validation reaches the model", () => {
  it.each([
    { status: "validated", marker: "PAGO DEL PAQUETE VALIDADO POR STUDIO FLOW" },
    { status: "provisional_active", marker: "PAQUETE PROVISIONAL, VALIDACIÓN PENDIENTE" },
  ])("uses current $status instead of stale conversation history", async ({ status, marker }) => {
    const h = orchestratorHarness(null, null, {
      id: "purchase",
      status,
      amount_minor: 80000,
      currency: "MXN",
    });
    h.input.testSimulation = undefined;
    h.input.serviceMode = true;
    h.input.studentId = "student";
    h.input.history = [
      { role: "assistant", content: "La validación definitiva está pendiente." },
      { role: "user", content: "¿Mi pago ya está validado?" },
    ];
    const from = h.input.supabase.from.bind(h.input.supabase);
    const filters: unknown[][] = [];
    h.input.supabase.from = ((table: string) => {
      const query = from(table) as never as { eq: (...args: unknown[]) => unknown };
      const eq = query.eq.bind(query);
      query.eq = (...args: unknown[]) => {
        if (table === "assistant_transfer_purchase_intents") filters.push(args);
        return eq(...args);
      };
      return query;
    }) as unknown as typeof h.input.supabase.from;
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.instructions).toContain(marker);
        if (status === "validated")
          expect(body.instructions).toContain(
            "No digas que la validación definitiva sigue pendiente",
          );
        else expect(body.instructions).toContain("No afirmes pago validado");
        return new Response(JSON.stringify(reply("Respuesta de prueba, sin modelo real.")));
      }),
    );
    await h.run(h.input);
    expect(filters).toContainEqual(["studio_id", "studio"]);
    expect(filters).toContainEqual(["conversation_id", "conversation"]);
    expect(filters).toContainEqual(["student_id", "student"]);
    expect(h.action).not.toHaveBeenCalled();
  });

  it.each(["awaiting_receipt", "rejected", "cancelled"])(
    "does not call a $status purchase validated",
    async (status) => {
      const h = orchestratorHarness(null, null, { id: "purchase", status });
      h.input.testSimulation = undefined;
      h.input.serviceMode = true;
      h.input.studentId = "student";
      h.input.history = [{ role: "user", content: "¿Mi pago ya está validado?" }];
      vi.stubEnv("OPENAI_API_KEY", "test");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.instructions).not.toContain("PAGO DEL PAQUETE VALIDADO POR STUDIO FLOW");
          return new Response(JSON.stringify(reply("Respuesta de prueba.")));
        }),
      );
      await h.run(h.input);
      expect(h.action).not.toHaveBeenCalled();
    },
  );
});

describe("handoff reasons match configured operational policies", () => {
  it.each([
    { demi: true, polina: false, legacy: false, expected: true },
    { demi: false, polina: true, legacy: false, expected: false },
    { demi: true, polina: true, legacy: false, expected: true },
    { demi: true, polina: false, legacy: true, expected: true },
    { demi: false, polina: true, legacy: true, expected: false },
  ])(
    "isolates Demi policies from another assistant, including legacy=$legacy, demi=$demi, polina=$polina",
    async ({ demi, polina, legacy, expected }) => {
      const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
        "lib/assistant/action-tools.ts",
        { "node:crypto": {}, "./read-tools": {}, "./group-booking": {} },
      );
      const rows = [
        {
          studio_id: "studio",
          assistant_key: "demi",
          reason_code: "refund_request",
          enabled: demi,
          blocking: true,
        },
        ...(!legacy
          ? [
              {
                studio_id: "studio",
                assistant_key: "polina",
                reason_code: "refund_request",
                enabled: polina,
                blocking: false,
              },
            ]
          : []),
        {
          studio_id: "other",
          assistant_key: "demi",
          reason_code: "refund_request",
          enabled: true,
          blocking: true,
        },
      ];
      const from = vi.fn(() => {
        const filters: Record<string, unknown> = {};
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters[key] = value;
            return query;
          },
          maybeSingle: async () => {
            if (legacy && "assistant_key" in filters) {
              return {
                data: null,
                error: {
                  code: "42703",
                  message: "column assistant_handoff_policies.assistant_key does not exist",
                },
              };
            }
            const matching = rows.filter((row) =>
              Object.entries(filters).every(([k, v]) => row[k as keyof typeof row] === v),
            );
            return matching.length > 1
              ? { data: null, error: { code: "PGRST116", message: "multiple rows" } }
              : { data: matching[0] ?? null, error: null };
          },
        };
        return query;
      });
      const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
      const result = await mod.executeAssistantActionTool(
        {
          supabase: { from, rpc } as never,
          studio: { id: "studio" } as never,
          conversationId: "conversation",
          turnId: "turn",
          studentId: "student",
          crmContactId: null,
          activationUrl: null,
          serviceMode: true,
          currentUserMessage: "Solicito reembolso",
        },
        "escalate_to_human",
        { reason_code: "refund_request" },
      );
      expect(result).toMatchObject({ ok: expected });
      expect(rpc).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(from).toHaveBeenCalledTimes(legacy ? 2 : 1);
    },
  );

  it.each([
    { code: "42501", message: "permission denied" },
    { code: "42703", message: "column unrelated_field does not exist" },
    { code: "PGRST116", message: "multiple rows" },
  ])("does not bypass policy errors ($code)", async (error) => {
    const mod = serverModule<typeof import("../lib/assistant/action-tools")>(
      "lib/assistant/action-tools.ts",
      { "node:crypto": {}, "./read-tools": {}, "./group-booking": {} },
    );
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error }),
    };
    const from = vi.fn(() => query);
    const rpc = vi.fn();
    const result = await mod.executeAssistantActionTool(
      {
        supabase: { from, rpc } as never,
        studio: { id: "studio" } as never,
        conversationId: "conversation",
        turnId: "turn",
        studentId: "student",
        crmContactId: null,
        activationUrl: null,
        serviceMode: true,
        currentUserMessage: "Necesito ayuda",
      },
      "escalate_to_human",
      { reason_code: "technical_block" },
    );
    expect(result).toMatchObject({ ok: false, error: "handoff_reason_not_enabled" });
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

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
