import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260928141335_packages02_schedule_restrictions.sql"),
  "utf8",
);
const actions = readFileSync(join(process.cwd(), "app/admin/productos/actions.ts"), "utf8");
const fields = readFileSync(
  join(process.cwd(), "app/admin/productos/product-form-fields.tsx"),
  "utf8",
);
const portal = readFileSync(join(process.cwd(), "lib/student/portal.ts"), "utf8");

describe("PAQUETES-02 schedule restrictions", () => {
  it("keeps unrestricted products backwards compatible", () => {
    expect(migration).toContain("not exists (");
    expect(migration).toContain("public.product_template_schedules pts_any");
  });

  it("matches restricted packages by recurring schedule", () => {
    expect(migration).toContain("pts.recurring_schedule_id = v_session.recurring_schedule_id");
    expect(migration).toContain("outside_product_schedule");
  });

  it("persists specific schedules in product create, update and duplicate flows", () => {
    expect(actions).toContain('formData.getAll("schedule_ids")');
    expect(actions).toContain('from("product_template_schedules")');
    expect(actions).toContain("schedule_discipline_mismatch");
    expect(actions).toContain("source.product_template_schedules");
  });

  it("exposes the approved all-vs-specific schedule editor", () => {
    expect(fields).toContain("Horarios permitidos");
    expect(fields).toContain("Todos los horarios de las disciplinas seleccionadas");
    expect(fields).toContain("Solo horarios específicos");
    expect(fields).toContain('name="schedule_ids"');
  });

  it("shows a clear student-facing reason", () => {
    expect(portal).toContain("Tu paquete no aplica para este horario");
  });
});
