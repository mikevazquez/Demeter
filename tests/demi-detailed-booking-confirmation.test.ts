import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  executeAssistantActionTool,
  isExplicitAssistantConfirmation,
  isExplicitCashPurchaseConfirmation,
} from "../lib/assistant/action-tools";
import { createTestSimulation, simulateAssistantAction } from "../lib/assistant/test-simulation";

const summary = {
  date: "2026-10-22",
  starts_at_local: "18:00",
  commercial_status: "package_covered",
  trial_booking: false,
};
const confirmation = "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete.";

describe("F01: detailed confirmation is bound to the pending booking", () => {
  it.each([
    confirmation,
    "Confirmo la reserva del jueves 22 de octubre de 2026 a las 18:00.",
    "Sí, confirmo esa reserva del 22 de octubre a las 18:00 con mi paquete.",
    "SÍ, CONFIRMO ESTA RESERVA DEL JUEVES 22 DE OCTUBRE A LAS 18:00 CON MI PAQUETE.",
  ])("accepts matching local details: %s", (message) => {
    expect(isExplicitAssistantConfirmation(message, summary)).toBe(true);
    expect(isExplicitAssistantConfirmation(message)).toBe(false);
    expect(isExplicitCashPurchaseConfirmation(message)).toBe(false);
  });

  it.each([
    "No confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete.",
    "¿Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete?",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete?",
    "Si hay lugar, confirmo la reserva del jueves 22 de octubre a las 18:00.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 si puedo.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00, pero no reserves.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00; mejor el viernes.",
    "Sí, confirmo la reserva del viernes 23 de octubre a las 18:00 con mi paquete.",
    "Sí, confirmo la reserva del viernes 22 de octubre a las 18:00 con mi paquete.",
    "Sí, confirmo la reserva del jueves 22 de noviembre a las 18:00 con mi paquete.",
    "Sí, confirmo la reserva del jueves 22 de octubre de 2027 a las 18:00.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 19:00 con mi paquete.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:01 con mi paquete.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con otro paquete.",
    "Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 en efectivo.",
  ])("rejects contradictions and extra clauses: %s", (message) => {
    expect(isExplicitAssistantConfirmation(message, summary)).toBe(false);
  });

  it.each([
    null,
    {},
    { ...summary, date: "2026-02-30" },
    { ...summary, date: "not-a-date" },
    { ...summary, starts_at_local: "19:00" },
    { ...summary, commercial_status: "payment_pending" },
    { ...summary, trial_booking: true },
  ])("fails closed with missing or incompatible summary %j", (pending) => {
    expect(isExplicitAssistantConfirmation(confirmation, pending)).toBe(false);
  });

  it("keeps short confirmations and accepts matching one-digit local hours", () => {
    expect(isExplicitAssistantConfirmation("Sí, confirmo.", summary)).toBe(true);
    expect(
      isExplicitAssistantConfirmation("Confirmo la reserva del jueves 22 de octubre a las 8:00.", {
        ...summary,
        starts_at_local: "08:00",
      }),
    ).toBe(true);
  });
  it("rejects incomplete questions and invalid local clock values", () => {
    expect(isExplicitAssistantConfirmation("¿Sí, confirmo", summary)).toBe(false);
    expect(isExplicitAssistantConfirmation("¿" + confirmation, summary)).toBe(false);
    for (const time of ["25:00", "18:99"]) {
      expect(
        isExplicitAssistantConfirmation(
          `Confirmo la reserva del jueves 22 de octubre a las ${time}.`,
          { ...summary, starts_at_local: time },
        ),
      ).toBe(false);
    }
  });
});

describe("booking executor keeps its independent barriers", () => {
  it.each([
    ["same turn", { prepared_turn_id: "current" }, {}, "confirmation_requires_new_turn"],
    ["different identity", { student_id: "other" }, {}, "conversation_identity_changed"],
    ["expired", {}, { expires_at: "2000-01-01T00:00:00Z" }, "confirmation_expired"],
    ["cancelled", {}, { status: "cancelled" }, "pending_action_not_available"],
    [
      "mismatched date",
      {},
      { confirmation_summary: { ...summary, date: "2026-10-23" } },
      "explicit_confirmation_required",
    ],
  ])("blocks %s before any RPC", async (_label, payload, overrides, error) => {
    const pending = {
      id: "pending",
      action_type: "booking.create",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      confirmation_summary: summary,
      action_payload: { student_id: "student", prepared_turn_id: "previous", ...payload },
      ...overrides,
    };
    const rpc = vi.fn();
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "limit", "update"]) chain[name] = () => chain;
    chain.maybeSingle = async () => ({ data: pending, error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    const result = await executeAssistantActionTool(
      {
        supabase: { from: () => chain, rpc } as never,
        studio: { id: "studio" } as never,
        conversationId: "conversation",
        turnId: "current",
        studentId: "student",
        crmContactId: null,
        activationUrl: null,
        serviceMode: true,
        currentUserMessage: confirmation,
      },
      "execute_booking",
      {},
    );
    expect(result).toMatchObject({ ok: false, error });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("simulator parity for detailed booking confirmation", () => {
  it("binds coverage from the prepared student fixture, then confirms those details", async () => {
    const state = createTestSimulation("student");
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const supabase = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data:
              table === "class_sessions"
                ? {
                    id: sessionId,
                    template_id: "template",
                    starts_at: "2099-01-02T00:00:00Z",
                    ends_at: "2099-01-02T01:00:00Z",
                    status: "scheduled",
                  }
                : { name: "Pole Fitness" },
            error: null,
          }),
        };
        return chain;
      },
    };
    const input = {
      state,
      supabase,
      studio: { id: "studio", timezone: "America/Mexico_City" },
      turnId: "prepare",
      currentUserMessage: "Quiero reservar",
    } as unknown as Parameters<typeof simulateAssistantAction>[0];
    expect(
      await simulateAssistantAction(input, "prepare_booking", {
        session_ref: `session:${sessionId}`,
      }),
    ).toMatchObject({ ok: true, status: "confirmation_required" });
    expect(state.pending?.summary).toMatchObject({
      date: "2099-01-01",
      starts_at_local: "18:00",
      commercial_status: "package_covered",
    });
    expect(
      await simulateAssistantAction(
        {
          ...input,
          turnId: "confirm",
          currentUserMessage:
            "Confirmo la reserva del 1 de enero de 2099 a las 18:00 con mi paquete.",
        },
        "execute_booking",
        {},
      ),
    ).toMatchObject({ ok: true, status: "executed" });
    expect(state.credits).toBe(7);
    expect(state.reservations).toHaveLength(1);
  });
  it("books and debits once in a new turn, then rejects another execution", async () => {
    const state = createTestSimulation("student");
    state.pending = { tool: "execute_booking", summary, preparedTurnId: "previous" };
    const input = {
      state,
      studio: { id: "studio" },
      supabase: {},
      turnId: "current",
      currentUserMessage: confirmation,
    } as unknown as Parameters<typeof simulateAssistantAction>[0];
    expect(await simulateAssistantAction(input, "execute_booking", {})).toMatchObject({
      ok: true,
      status: "executed",
    });
    expect(state.credits).toBe(7);
    expect(state.reservations).toHaveLength(1);
    expect(await simulateAssistantAction(input, "execute_booking", {})).toMatchObject({
      ok: false,
    });
    expect(state.credits).toBe(7);
    expect(state.reservations).toHaveLength(1);
  });

  it.each([
    "execute_booking",
    "execute_cancellation",
    "execute_reschedule",
    "execute_waitlist_join",
  ])(
    "rejects same-turn execution and never authorizes detailed non-booking action %s",
    async (tool) => {
      const state = createTestSimulation("student");
      const input = {
        state,
        studio: { id: "studio" },
        supabase: {},
        turnId: "current",
        currentUserMessage: confirmation,
      } as unknown as Parameters<typeof simulateAssistantAction>[0];
      state.pending = { tool, summary, preparedTurnId: "current" };
      expect(await simulateAssistantAction(input, tool, {})).toMatchObject({ ok: false });
      if (tool !== "execute_booking") {
        state.pending.preparedTurnId = "previous";
        expect(await simulateAssistantAction(input, tool, {})).toMatchObject({ ok: false });
      }
      expect(state.credits).toBe(8);
      expect(state.reservations).toHaveLength(0);
    },
  );
});
