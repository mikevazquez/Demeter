import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const action = readFileSync("app/admin/alumnas/contactos/[contactId]/agendar/actions.ts", "utf8");
const page = readFileSync("app/admin/alumnas/contactos/[contactId]/agendar/page.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261013010000_admin_schedule_prospect_trial.sql",
  "utf8",
);

describe("manual prospect first-class booking", () => {
  it("requires a payment method in the form and validates it again on the server", () => {
    expect(page).toMatch(/name="payment_method"[\s\S]*?required/);
    expect(action).toContain('["cash", "bank_transfer"].includes(paymentMethod)');
  });

  it("books the existing CRM prospect through the trial eligibility flow", () => {
    expect(migration).toContain("assistant_trial_booking_preview");
    expect(migration).toContain("assistant_confirm_trial_booking");
    expect(migration).toContain("target_contact_id");
    expect(migration).toContain("has_capability(v_studio_id, 'students.write')");
  });

  it("persists the selected payment method and leaves payment pending for review", () => {
    expect(migration).toContain("payment_preference = v_method");
    expect(migration).toContain("payment_status', 'payment_pending'");
    expect(migration).toContain("payment_review_required', v_method = 'bank_transfer'");
  });
});
