import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi trial prepay funnel", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const webhook = source("app/api/integrations/meta-whatsapp/webhook/route.ts");
  const prepayMigration = source(
    "supabase/migrations/20261007064000_trial_prepay_first_class.sql",
  );
  const expiryMigration = source(
    "supabase/migrations/20261007065000_trial_prepay_expiry_window.sql",
  );
  const reminderMigration = source(
    "supabase/migrations/20261007070000_trial_reminder_24h.sql",
  );

  it("does not create the trial reservation before payment", () => {
    expect(actions).toContain("require_payment_before_booking");
    expect(actions).toContain("service_prepare_trial_transfer");
    expect(actions).toContain('status: "payment_required"');
    expect(actions).toContain("reservation_confirmed: false");
    expect(orchestrator).toContain("Tu lugar todavía no está confirmado");
  });

  it("requires a matching receipt before confirming the trial", () => {
    expect(webhook).toContain("receipt_amount_matches");
    expect(webhook).toContain("service_activate_trial_transfer_receipt");
    expect(prepayMigration).toContain("receipt_amount_not_matched");
    expect(prepayMigration).toContain("service_confirm_trial_booking_with_resource");
    expect(prepayMigration).toContain("commercial_status='paid'");
  });

  it("preserves review and revokes the reservation if the transfer is rejected", () => {
    expect(prepayMigration).toContain("sync_trial_transfer_review");
    expect(prepayMigration).toContain("new.status='rejected'");
    expect(prepayMigration).toContain("cancelled_by_studio");
    expect(prepayMigration).toContain("new.status='validated'");
  });

  it("limits an unpaid intent and adds the paid-trial 24h reminder", () => {
    expect(expiryMigration).toContain("interval '30 minutes'");
    expect(reminderMigration).toContain("p0.booking.trial_reminder_24h");
    expect(reminderMigration).toContain("'minutes_before',1440");
    expect(reminderMigration).toContain("'reservation.commercial_status'");
    expect(reminderMigration).toContain("'student.student_type'");
  });
});
