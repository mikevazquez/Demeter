import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260928151449_packages02_schedule_restrictions_prod.sql",
  ),
  "utf8",
);
const actions = readFileSync(join(process.cwd(), "app/admin/productos/actions.ts"), "utf8");
const fields = readFileSync(
  join(process.cwd(), "app/admin/productos/product-form-fields.tsx"),
  "utf8",
);
const portal = readFileSync(join(process.cwd(), "lib/student/portal.ts"), "utf8");

describe("PAQUETES-02 schedule restrictions", () => {
  it("keeps existing products unrestricted when no schedule rows exist", () => {
    expect(migration).toContain("not exists (");
    expect(migration).toContain("public.product_template_schedules pts_any");
  });

  it("matches restricted products by recurring schedule id", () => {
    expect(migration).toContain("pts.recurring_schedule_id = v_session.recurring_schedule_id");
    expect(migration).toContain("outside_product_schedule");
  });

  it("preserves the production enrollment policy gate", () => {
    expect(migration).toContain("public.enrollment_policies%rowtype");
    expect(migration).toContain("required_for_booking");
    expect(migration).toContain("public.student_enrollments");
  });

  it("persists and validates selected recurring schedules", () => {
    expect(actions).toContain('formData.getAll("schedule_ids")');
    expect(actions).toContain('from("product_template_schedules")');
    expect(actions).toContain("schedule_discipline_mismatch");
    expect(actions).toContain("source.product_template_schedules");
  });

  it("exposes all-vs-specific schedule controls", () => {
    expect(fields).toContain("Horarios permitidos");
    expect(fields).toContain("Todos los horarios de las disciplinas seleccionadas");
    expect(fields).toContain("Solo horarios específicos");
    expect(fields).toContain('name="schedule_ids"');
  });

  it("shows a clear student-facing reason", () => {
    expect(portal).toContain("Tu paquete no aplica para este horario");
  });
});
