// SF-177 final rebase gate against approved ADMIN Hoy.
// SF-177 contract tests run against the live main baseline.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921050000_sf177_walkin_commercial_pending.sql"),
  "utf8",
);
const bindMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260921053000_sf177_bind_resolved_walkin_acquisition.sql",
  ),
  "utf8",
);
const todayPage = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
const sessionOperations = readFileSync(
  join(process.cwd(), "app/admin/hoy/SessionOperations.tsx"),
  "utf8",
);

describe("SF-177 walk-in commercial pending", () => {
  it("emits one auditable pending event for uncovered walk-ins", () => {
    expect(migration).toContain("p_event_type => 'walkin.commercial_pending'");
    expect(migration).toContain("'walkin.commercial_pending:' || v_reservation_id::text");
    expect(migration).toContain("'commercial_pending', true");
    expect(migration).toContain("'reason_code', v_reason");
    expect(migration).toContain("'reason_code', 'no_active_product'");
  });

  it("preserves covered walk-ins without creating a pending event", () => {
    expect(migration).toContain("'commercial_pending', false");
    expect(migration).toContain("'acquisition_id', v_acquisition_id");
    expect(migration).toContain("if coalesce((v_eligibility->>'eligible')::boolean, false) then");
  });

  it("auto-resolves from final commercial coverage using deferred triggers", () => {
    expect(migration).toContain("create constraint trigger sf177_resolve_walkin_after_acquisition");
    expect(migration).toContain("deferrable initially deferred");
    expect(migration).toContain("create constraint trigger sf177_resolve_walkin_after_credit");
    expect(migration).toContain("private.sf177_walkin_commercial_coverage");
    expect(migration).toContain("p_event_type => 'walkin.commercial_resolved'");
    expect(migration).toContain("'walkin.commercial_resolved:' || v_pending.reservation_id::text");
    expect(migration).toContain("p_causation_event_id => v_pending.event_id");
  });

  it("does not reintroduce the retired required-actions subsystem", () => {
    expect(migration).not.toContain("create table public.required_actions");
    expect(migration).not.toContain("insert into public.required_actions");
    expect(migration).not.toContain("from public.required_actions");
    expect(migration).not.toContain("public.required_action_audit");

    for (const source of [todayPage, sessionOperations]) {
      expect(source).not.toContain("/admin/acciones");
      expect(source).not.toContain("AUT-CAT-08");
      expect(source).not.toContain("AUT-CAT-09");
      expect(source).not.toContain("AUT-CAT-10");
    }
  });

  it("surfaces the pending commercial state inside the class context", () => {
    expect(todayPage).toContain('"Venta pendiente"');
    expect(todayPage).toContain('"Regularizar en Ventas"');
    expect(todayPage).toContain('"walkin.commercial_pending"');
    expect(todayPage).toContain('"walkin.commercial_resolved"');
    expect(sessionOperations).toContain("Resolver venta pendiente");
    expect(sessionOperations).toContain("/admin/ventas/nueva?student_id=");
  });

  it("keeps the commercial repair inside the approved sales flow", () => {
    expect(sessionOperations).toContain("canWriteSales");
    expect(sessionOperations).toContain("item.commercialPending");
    expect(sessionOperations).toContain("item.studentId");
  });
  it("accepts normalized E.164 walk-in phone numbers without legacy +521", () => {
    expect(migration).toContain("p_phone !~ '^[+][1-9][0-9]{7,14}$'");
  });
  it("binds resolved walk-ins to the covering acquisition and holds credits", () => {
    expect(bindMigration).toContain("set acquisition_id = v_acquisition_id");
    expect(bindMigration).toContain("'reserve'");
    expect(bindMigration).toContain("on conflict (reservation_id, movement_type) do nothing");
    expect(bindMigration).toContain("v_balance < v_credit_cost");
    expect(bindMigration).toContain("p_event_type => 'walkin.commercial_resolved'");
  });
});
