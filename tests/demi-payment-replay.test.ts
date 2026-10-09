import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

function harness(status: string, reservationStatus = "reserved", prospect = true) {
  const source = readFileSync("lib/assistant/action-tools.ts", "utf8").replace(
    'import "server-only";',
    "",
  );
  const loadedModule = { exports: {} as typeof import("../lib/assistant/action-tools") };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(source, { loader: "ts", format: "cjs" }).code,
  )(() => ({}), loadedModule, loadedModule.exports);
  const rpc = vi.fn(() => {
    throw new Error("Replay must not execute a new operation");
  });
  const supabase = {
    rpc,
    from(table: string) {
      const rows: Record<string, unknown> = {
        assistant_pending_actions: {
          status: "executed",
          execution_ref: `${prospect ? "prospect" : "trial"}-payment:payment`,
          confirmation_summary: { trial_booking: true },
        },
        demi_group_bookings: { id: "payment", status, amount_minor: 15000, currency: "MXN" },
        assistant_transfer_purchase_intents: {
          id: "payment",
          status,
          amount_minor: 15000,
          currency: "MXN",
          reservation_id: "reservation",
        },
        studio_bank_transfer_settings: {
          bank_name: "UAT",
          account_holder: "UAT",
          account_number: "0000",
        },
        demi_group_participants: { reservation_id: "reservation" },
        reservations: { id: "reservation", status: reservationStatus },
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  };
  return {
    rpc,
    execute: () =>
      loadedModule.exports.executeAssistantActionTool(
        {
          supabase,
          studio: { id: "studio", currency: "MXN" },
          conversationId: "conversation",
          turnId: "turn",
          studentId: null,
          crmContactId: "contact",
          activationUrl: null,
          serviceMode: true,
          currentUserMessage: "Sí, confirmo la reserva",
        } as never,
        "execute_booking",
        {},
      ),
  };
}

describe("Repeated booking confirmation uses persisted payment and reservation state", () => {
  it.each([true, false])(
    "requires receipt instead of inventing a booking (prospect=%s)",
    async (prospect) => {
      const h = harness("awaiting_receipt", "reserved", prospect);
      expect(await h.execute()).toMatchObject({
        ok: true,
        status: "payment_required",
        reservation_confirmed: false,
        amount_minor: 15000,
      });
      expect(h.rpc).not.toHaveBeenCalled();
    },
  );
  it("asks for personal data after receipt without claiming a reservation", async () => {
    expect(await harness("awaiting_participants").execute()).toMatchObject({
      status: "participant_data_required",
      reservation_confirmed: false,
    });
  });
  it.each(["provisional", "validated"])(
    "confirms only an actual active reservation (%s)",
    async (status) => {
      expect(await harness(status).execute()).toMatchObject({
        status: "executed",
        reservation_confirmed: true,
        reservation_ref: "reservation",
      });
    },
  );
  it("does not revive a cancelled booking from an old payment", async () => {
    expect(await harness("validated", "cancelled_on_time").execute()).toMatchObject({
      ok: false,
      error: "reservation_not_active",
      reservation_confirmed: false,
    });
  });
  it.each(["rejected", "partial", "expired"])(
    "never confirms an incomplete or rejected payment (%s)",
    async (status) => {
      expect(await harness(status).execute()).toMatchObject({
        ok: false,
        error: "payment_not_booked",
        reservation_confirmed: false,
      });
    },
  );
});

function firstPaymentHarness(
  studentId: string | null = null,
  bankEnabled = true,
  externalCheckout: Record<string, unknown> | null = null,
) {
  const source = readFileSync("lib/assistant/action-tools.ts", "utf8").replace(
    'import "server-only";',
    "",
  );
  const loadedModule = { exports: {} as typeof import("../lib/assistant/action-tools") };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(source, { loader: "ts", format: "cjs" }).code,
  )(() => ({}), loadedModule, loadedModule.exports);
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "service_get_demi_first_class_payment_options"
        ? { ok: true, external_checkout: externalCheckout }
        : {
            ok: true,
            group_id: "group",
            status: "awaiting_receipt",
            participant_count: 1,
            amount_minor: 15000,
            currency: "MXN",
          },
    error: null,
  }));
  const writes = vi.fn(() => {
    throw new Error("Payment quote cannot create a student or booking");
  });
  const supabase = {
    rpc,
    from(table: string) {
      const rows: Record<string, unknown> = {
        trial_booking_policies: { require_payment_before_booking: true },
        assistant_booking_behaviors: { prospect_require_payment_before_booking: true },
        class_sessions: {
          id: "session",
          template_id: "template",
          starts_at: new Date(Date.now() + 86400000).toISOString(),
          ends_at: new Date(Date.now() + 90000000).toISOString(),
          status: "scheduled",
          requires_resource: false,
        },
        class_templates: { name: "UAT", drop_in_price_minor: 15000, credit_cost: 1 },
        studio_payment_methods: { code: "bank_transfer" },
        studio_bank_transfer_settings: bankEnabled
          ? { bank_name: "UAT", account_holder: "UAT", account_number: "0000" }
          : null,
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert: writes,
        update: writes,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  };
  return {
    rpc,
    writes,
    execute: () =>
      loadedModule.exports.executeAssistantActionTool(
        {
          supabase,
          studio: { id: "studio", currency: "MXN", timezone: "America/Mexico_City" },
          conversationId: "conversation",
          turnId: "turn",
          studentId,
          crmContactId: "contact",
          activationUrl: null,
          serviceMode: true,
          currentUserMessage: "Quiero mi primera clase por transferencia",
        } as never,
        "prepare_first_class_payment",
        { session_ref: "session:11111111-1111-4111-8111-111111111111", resource_ref: null },
      ),
  };
}

describe("First-class payment prepares only a quote for a verified prospect", () => {
  it("provides configured bank details without a student, booking or extra confirmation", async () => {
    const h = firstPaymentHarness();
    expect(await h.execute()).toMatchObject({
      ok: true,
      status: "payment_required",
      reservation_confirmed: false,
      group_id: "group",
      participant_count: 1,
      amount_minor: 15000,
      bank_details: { account_number: "0000" },
    });
    expect(h.rpc).toHaveBeenCalledWith(
      "service_prepare_demi_prospect_payment",
      expect.objectContaining({
        p_contact: "contact",
        p_conversation: "conversation",
        p_studio: "studio",
      }),
    );
    expect(h.writes).not.toHaveBeenCalled();
  });
  it("cannot start a new-prospect payment for an existing student", async () => {
    const h = firstPaymentHarness("student");
    expect(await h.execute()).toMatchObject({
      ok: false,
      reason_code: "verified_prospect_required",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("does not prepare a charge when bank details are missing", async () => {
    const h = firstPaymentHarness(null, false);
    expect(await h.execute()).toMatchObject({
      ok: false,
      reason_code: "transfer_details_unavailable",
    });
    expect(
      h.rpc.mock.calls.some(([name]) => name === "service_prepare_demi_prospect_payment"),
    ).toBe(false);
  });
  it("offers the configured external link without creating a student or reservation", async () => {
    const checkout = {
      url: "https://mpago.la/UAT-FICTICIO-NO-PAGAR",
      amount_minor: 15000,
      currency: "MXN",
      receipt_required: true,
      test_only: true,
    };
    const h = firstPaymentHarness(null, false, checkout);
    expect(await h.execute()).toMatchObject({
      ok: true,
      external_checkout: checkout,
      bank_details: null,
      reservation_confirmed: false,
      receipt_required: true,
    });
    expect(h.writes).not.toHaveBeenCalled();
  });
  it.each([
    { amount_minor: 10000, currency: "MXN" },
    { amount_minor: 15000, currency: "USD" },
  ])("rejects an external link that does not match the quote: %j", async (amount) => {
    const h = firstPaymentHarness(null, false, {
      url: "https://mpago.la/UAT-FICTICIO-NO-PAGAR",
      ...amount,
    });
    expect(await h.execute()).toMatchObject({
      ok: false,
      reason_code: "external_checkout_amount_mismatch",
      reservation_confirmed: false,
    });
    expect(h.writes).not.toHaveBeenCalled();
  });
});
