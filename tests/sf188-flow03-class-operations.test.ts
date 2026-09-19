import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-188 FLUJO 03 class operations", () => {
  const migrationPath =
    "supabase/migrations/20260919003000_sf188_flow03_class_operations.sql";

  it("shares commercial eligibility without relaxing normal future booking", () => {
    const migration = source(migrationPath);

    expect(migration).toContain("private.booking_eligibility_core");
    expect(migration).toContain("p_allow_started_session boolean default false");
    expect(migration).toContain("target_student_id,\n    false");
    expect(migration).toContain("target_student_id,\n    true");
    expect(migration).toContain(
      "revoke all on function private.booking_eligibility_core(uuid, uuid, boolean)",
    );
  });

  it("keeps active-class walk-in eligibility capability-scoped", () => {
    const activeEligibility = source(
      "supabase/migrations/20260919010500_sf188_flow03_admin_walkin_eligibility.sql",
    );
    const adminPage = source("app/admin/page.tsx");

    expect(activeEligibility).toContain("public.attendance_walkin_eligibility");
    expect(activeEligibility).toContain("private.can_manage_attendance_session");
    expect(activeEligibility).toContain("target_student_id,\n    true");
    expect(adminPage).toContain('"attendance_walkin_eligibility"');
    expect(adminPage).toContain("classIsInOperation");
  });

  it("uses canonical acquisition and credit hold for covered existing walk-ins", () => {
    const migration = source(migrationPath);

    expect(migration).toContain("'commercial_pending', false");
    expect(migration).toContain("v_acquisition_id");
    expect(migration).toContain("'reserve'");
    expect(migration).toContain("-v_credit_cost");
    expect(migration).toContain("public.acquisition_credit_balance(v_acquisition_id)");
  });

  it("limits commercial-pending fallback to the already approved exceptions", () => {
    const migration = source(migrationPath);

    expect(migration).toContain(
      "if v_reason not in ('no_active_product', 'outside_product', 'no_credits') then",
    );
    expect(migration).toContain("'commercial_pending', true");
    expect(migration).toContain("'reason_code', v_reason");
    expect(migration).not.toContain(
      "v_reason not in ('no_active_product', 'outside_product', 'no_credits', 'payment_pending')",
    );
  });

  it("snapshots the real class credit cost for walk-ins", () => {
    const migration = source(migrationPath);

    expect(migration).toContain("greatest(coalesce(ct.credit_cost, 1), 1)");
    expect(migration).toContain("'credit_cost', v_credit_cost");
  });

  it("exposes traceable post-finalization correction history inside attendance scope", () => {
    const migration = source(migrationPath);
    const finalized = source("app/coach/clases/[sessionId]/finalizada/page.tsx");

    expect(migration).toContain("public.attendance_correction_history");
    expect(migration).toContain("private.can_manage_attendance_session");
    expect(migration).toContain("from public.attendance_corrections ac");
    expect(finalized).toContain('"attendance_correction_history"');
    expect(finalized).toContain("Historial de correcciones");
    expect(finalized).toContain("correction.reason");
  });

  it("keeps first_usage aligned with the approved first billable usage rule", () => {
    const flow01 = source(
      "supabase/migrations/20260918180000_flow01_first_usage_activation.sql",
    );

    expect(flow01).toContain("private.activate_acquisition_on_first_usage");
    expect(flow01).toContain("if v_new_status='cancelled_late' then");
    expect(flow01).toContain(
      "where r.session_id=target_session_id and r.status in ('attended','no_show')",
    );
  });

  it("shows pending feedback for attendance, walk-in, finalization, and corrections", () => {
    const roster = source("app/coach/clases/[sessionId]/roster/page.tsx");
    const walkin = source("app/coach/clases/[sessionId]/walk-in/walk-in-form.tsx");
    const summary = source("app/coach/clases/[sessionId]/resumen/page.tsx");
    const finalized = source("app/coach/clases/[sessionId]/finalizada/page.tsx");
    const actions = source("app/coach/actions.ts");
    const adminOperations = source("app/admin/hoy/SessionOperations.tsx");
    const adminActions = source("app/admin/actions.ts");

    expect(roster).toContain("PendingActionButton");
    expect(walkin).toContain("PendingActionButton");
    expect(summary).toContain('pendingLabel="Finalizando…"');
    expect(finalized).toContain('pendingLabel="Corrigiendo…"');
    expect(actions).toContain(
      'const walkinState = result.commercial_pending ? "pending" : "covered"',
    );
    expect(adminOperations).toContain("PendingActionButton");
    expect(adminOperations).toContain('created === "walkin-covered"');
    expect(adminActions).toContain("classIsInOperation");
    expect(adminActions).toContain('supabase.rpc("add_existing_walkin_student"');
  });
});
