import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS-01 official holidays domain", () => {
  const migration = source("supabase/migrations/20260924050000_festivos01_official_holidays.sql");

  it("stores official holidays separately from the studio operation decision", () => {
    expect(migration).toContain("create table if not exists public.official_holidays");
    expect(migration).toContain("create table if not exists public.studio_holiday_overrides");
    expect(migration).toContain("operation_mode in ('normal', 'closed', 'special')");
    expect(migration).toContain("source_url");
    expect(migration).toContain("source_checked_at");
  });

  it("loads the Article 74 recurring holidays and the six-year executive transfer", () => {
    expect(migration).toContain("'new_year'");
    expect(migration).toContain("'constitution'");
    expect(migration).toContain("'benito_juarez'");
    expect(migration).toContain("'labor_day'");
    expect(migration).toContain("'independence'");
    expect(migration).toContain("'revolution'");
    expect(migration).toContain("'executive_transfer'");
    expect(migration).toContain("'christmas'");
    expect(migration).toContain("mod(y - 2024, 6) = 0");
  });

  it("does not cancel a holiday merely because the official date exists", () => {
    expect(migration).toContain("coalesce(o.operation_mode, 'normal')");
    expect(migration).toContain("if v_operation_mode = 'closed'");
    expect(migration).toContain("v_operation_mode = 'special'");
    expect(migration).not.toContain(
      "official_holiday_id is not null then\n        update public.class_sessions",
    );
  });

  it("prevents recurring materialization on closed days and filters special schedules", () => {
    expect(migration).toContain("create or replace function public.materialize_recurring_schedule");
    expect(migration).toContain("v_operation_mode = 'closed'");
    expect(migration).toContain("v_operation_mode = 'special'");
    expect(migration).toContain("special_recurring_schedule_ids");
    expect(migration).toContain("continue;");
  });

  it("reuses the normal studio cancellation and refund flow with a holiday reason", () => {
    expect(migration).toContain("cancellation_reason = v_reason");
    expect(migration).toContain("Cierre por %s");
    expect(migration).toContain("private.cancel_session_reservations_internal");
    expect(migration).toContain("new.cancellation_reason");
  });

  it("exposes holiday context and restored-credit evidence to the student portal", () => {
    expect(migration).toContain("public.student_holiday_snapshot");
    expect(migration).toContain("public.student_holiday_week_snapshot");
    expect(migration).toContain("'credit_restored'");
    expect(migration).toContain("cl.movement_type = 'release'");
  });

  it("keeps an audit trail for every studio decision", () => {
    expect(migration).toContain("public.studio_holiday_override_history");
    expect(migration).toContain("configured_by");
    expect(migration).toContain("created_by");
  });
});
