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
