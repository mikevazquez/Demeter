import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo C2 · combo de clase desde Hoy", () => {
  const detail = source("app/admin/agenda/[sessionId]/page.tsx");
  const panel = source("app/admin/agenda/[sessionId]/PoleClassComboPanel.tsx");
  const client = source("app/admin/agenda/[sessionId]/PoleClassComboClient.tsx");
  const action = source("app/admin/agenda/[sessionId]/pole-actions.ts");
  const styles = source("app/admin/agenda/[sessionId]/pole-class-combo.module.css");

  it("mounts the Pole combo generator in class detail", () => {
    expect(detail).toContain("<PoleClassComboPanel");
    expect(detail).toContain("template?.discipline_id");
    expect(detail).toContain("CAPABILITIES.EVALUATIONS_WRITE");
  });

  it("uses scheduled students, their levels and achievements", () => {
    expect(panel).toContain('.from("student_discipline_levels")');
    expect(panel).toContain('.from("student_pole_figure_achievements")');
    expect(panel).toContain('.from("pole_figure_profiles")');
    expect(panel).toContain("groupLevelOrder");
    expect(panel).toContain("catalog.combos_base");
  });

  it("keeps Professional outside automatic generation", () => {
    expect(panel).toContain("Principiante: 1");
    expect(panel).toContain("Intermedio: 2");
    expect(panel).toContain("Avanzado: 4");
    expect(panel).not.toContain("Profesional:");
  });

  it("marks the new figure from the actual class session", () => {
    expect(client).toContain("Figura nueva de hoy");
    expect(client).toContain("Marcar hecha");
    expect(action).toContain("set_student_pole_figure_achievement");
    expect(action).toContain("p_class_session_id: sessionId");
    expect(action).toContain("CAPABILITIES.EVALUATIONS_WRITE");
  });

  it("uses Sendero for the combo panel", () => {
    expect(styles).toContain("#8fe6c8");
    expect(styles).toContain('"Sendero Marcellus"');
    expect(styles).toContain("#2a2c33");
    expect(styles).toContain("@media (max-width: 760px)");
  });
});
