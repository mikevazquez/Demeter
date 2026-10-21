import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEMI-PROS-03B enrollment + package in one transfer (D-PAY-03)", () => {
  const migration = source(
    "supabase/migrations/20261021200000_demi_transfer_enrollment_and_package.sql",
  );
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("asks before charging a required enrollment", () => {
    expect(contracts).toContain('required: ["session_ref", "product_ref", "enrollment_accepted"]');
    expect(actions).toContain("service_preview_transfer_purchase");
    expect(actions).toContain('reason_code: "enrollment_confirmation_required"');
    expect(actions).toContain("args.enrollment_accepted !== true");
    expect(orchestrator).toContain(
      'resultObject.reason_code === "enrollment_confirmation_required"',
    );
  });

  it("charges the total in the intent and never adds enrollment to included products", () => {
    expect(migration).toContain("v_product.price_minor+v_enrollment_amount");
    expect(migration).toContain("if not coalesce(v_product.enrollment_included,false) then");
    expect(migration).toContain("required_for_package_purchase");
    expect(migration).toContain("private.student_has_active_enrollment");
  });

  it("records a paid enrollment line on activation and revokes it on rejection", () => {
    expect(migration).toContain("v_product.currency,v_intent.amount_minor,null,v_intent.id");
    expect(migration).toContain("'paid',");
    expect(migration).toContain("resolution_type in ('promotion','paid')");
  });

  it("keeps service-only grants on the new preview", () => {
    expect(migration).toContain(
      "revoke all on function public.service_preview_transfer_purchase(uuid,uuid,uuid) from public,anon,authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.service_preview_transfer_purchase(uuid,uuid,uuid) to service_role;",
    );
  });
});
