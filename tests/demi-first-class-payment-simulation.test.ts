import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createTestSimulation, simulateAssistantAction } from "../lib/assistant/test-simulation";

const sessionId = "11111111-1111-4111-8111-111111111111";
function harness() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    class_sessions: [
      {
        id: sessionId,
        studio_id: "studio",
        template_id: "template",
        status: "scheduled",
        starts_at: "2099-01-01T18:00:00Z",
        capacity: 5,
      },
    ],
    class_templates: [
      { id: "template", studio_id: "studio", name: "Pole Fitness", drop_in_price_minor: 15000 },
    ],
    reservations: [],
    studio_payment_methods: [{ studio_id: "studio", code: "bank_transfer", active: true }],
    studio_bank_transfer_settings: [
      {
        studio_id: "studio",
        enabled: true,
        bank_name: "Configured bank",
        account_holder: "Real holder must not escape",
        clabe: "DO-NOT-EXPOSE-THIS-ACCOUNT",
      },
    ],
    demi_mercadopago_settings: [],
  };
  const forbidden = vi.fn(() => {
    throw new Error("No business writes, payment RPCs or provider calls");
  });
  const scopes: string[] = [];
  const supabase = {
    rpc: forbidden,
    functions: { invoke: forbidden },
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const response = () => ({
        data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))),
        error: null,
        count: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))).length,
      });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          if (key === "studio_id") scopes.push(String(value));
          filters.push((row) => row[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        maybeSingle: async () => ({ ...response(), data: response().data[0] ?? null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve),
        insert: forbidden,
        update: forbidden,
        delete: forbidden,
        upsert: forbidden,
      };
      return query;
    },
  };
  const state = createTestSimulation("prospect");
  state.paymentBeforeBooking = true;
  const input = {
    supabase,
    state,
    studio: { id: "studio", timezone: "America/Mexico_City", currency: "MXN" },
    turnId: "turn",
    currentUserMessage: "Pásame cómo depositar en OXXO para mi clase.",
  } as unknown as Parameters<typeof simulateAssistantAction>[0];
  const prepare = () =>
    simulateAssistantAction(input, "prepare_first_class_payment", {
      session_ref: `session:${sessionId}`,
    });
  return { rows, state, input, prepare, forbidden, scopes };
}

describe("SIM-01: first-class payment instructions are read-only and synthetic", () => {
  it("uses configured price and availability, redacts bank details and replays without effects", async () => {
    const h = harness();
    const before = JSON.stringify(h.state);
    const result = await h.prepare();
    expect(result).toMatchObject({
      ok: true,
      simulated: true,
      status: "payment_required",
      amount_minor: 15000,
      reservation_confirmed: false,
      payment_verified: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/DO-NOT-EXPOSE|Real holder/);
    expect(JSON.stringify(result)).toContain("No realices transferencias");
    expect(await h.prepare()).toEqual(result);
    expect(JSON.stringify(h.state)).toBe(before);
    expect(h.scopes.every((id) => id === "studio")).toBe(true);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    "disabled_method",
    "missing_bank",
    "missing_price",
    "full",
    "foreign_session",
    "already_reserved",
  ])("fails closed for %s", async (variant) => {
    const h = harness();
    if (variant === "disabled_method") h.rows.studio_payment_methods[0].active = false;
    if (variant === "missing_bank") h.rows.studio_bank_transfer_settings = [];
    if (variant === "missing_price") h.rows.class_templates[0].drop_in_price_minor = null;
    if (variant === "full") h.rows.class_sessions[0].capacity = 0;
    if (variant === "foreign_session") h.rows.class_sessions[0].studio_id = "other";
    if (variant === "already_reserved") h.state.reservations.push({ reservation_ref: "existing" });
    expect(await h.prepare()).toMatchObject({ ok: false, simulated: true });
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("uses only an invalid demonstration checkout when automatic payment is configured", async () => {
    const h = harness();
    h.rows.demi_mercadopago_settings = [{ studio_id: "studio", enabled: true }];
    h.input.currentUserMessage = "Quiero un enlace de Mercado Pago para esa clase.";
    expect(await h.prepare()).toMatchObject({
      ok: true,
      external_checkout: { url: "https://example.invalid/demi-workbench-payment", test_only: true },
      reservation_confirmed: false,
    });
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});
