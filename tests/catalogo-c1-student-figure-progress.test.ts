import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo C1 · progreso de figuras por alumna", () => {
  const action = source("app/admin/alumnas/[studentId]/figure-actions.ts");
  const panel = source("app/admin/alumnas/[studentId]/StudentFiguresPanel.tsx");
  const client = source("app/admin/alumnas/[studentId]/StudentFiguresClient.tsx");
  const profile = source("app/admin/alumnas/[studentId]/page.tsx");
  const overview = source("app/admin/alumnas/[studentId]/Profile360Overview.tsx");
  const styles = source("app/admin/alumnas/[studentId]/student-figures.module.css");

  it("requires evaluation write access before changing figure progress", () => {
    expect(action).toContain("CAPABILITIES.EVALUATIONS_WRITE");
    expect(action).toContain("set_student_pole_figure_achievement");
    expect(action).toContain("revalidatePath");
  });

  it("loads mapped Pole elements and the student's persisted progress", () => {
    expect(panel).toContain('.from("technical_elements")');
    expect(panel).toContain("pole_catalog_slug");
    expect(panel).toContain('.from("student_pole_figure_achievements")');
    expect(panel).toContain('.eq("student_id", studentId)');
  });

  it("supports done and pending states with manual instructor actions", () => {
    expect(client).toContain('"completed"');
    expect(client).toContain('"pending"');
    expect(client).toContain("Marcar hecha");
    expect(client).toContain("Mover a pendiente");
    expect(client).toContain("Solo programa base");
  });

  it("exposes figures inside the student operation profile", () => {
    expect(profile).toContain('"figures"');
    expect(profile).toContain("<StudentFiguresPanel");
    expect(overview).toContain('href("figures")');
    expect(overview).toContain("Figuras");
  });

  it("uses Sendero visual tokens for the figures panel", () => {
    expect(styles).toContain('#8fe6c8');
    expect(styles).toContain('"Sendero Marcellus"');
    expect(styles).toContain("#2a2c33");
    expect(styles).toContain("@media (max-width: 760px)");
  });
});
