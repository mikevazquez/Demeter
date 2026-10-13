import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261013052000_demi_trial_payment_reservation_status.sql",
  "utf8",
);

describe("Demi provisional trial transfer reservation status", () => {
  it("marks receipt-backed reservations pending until human approval", () => {
    expect(migration).toContain("new.status = 'provisional_active'");
    expect(migration).toContain("commercial_status = 'payment_pending'");
    expect(migration).toContain("new.reservation_id");
    expect(migration).toContain("and studio_id = new.studio_id");
  });

  it("marks the reservation paid only after the transfer intent is validated", () => {
    expect(migration).toContain("new.status = 'validated'");
    expect(migration).toContain("commercial_status = 'paid'");
    expect(migration).toContain(
      "after update of status on public.assistant_transfer_purchase_intents",
    );
  });
});
