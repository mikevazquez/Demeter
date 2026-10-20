import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo C1 · progreso de figuras por alumna", () => {
  const panel = source("app/admin/alumnas/[studentId]/StudentFiguresPanel.tsx");
  const client = source("app/admin/alumnas/[studentId]/StudentFiguresClient.tsx");
  const profile = source("app/admin/alumnas/[studentId]/page.tsx");
  const overview = source("app/admin/alumnas/[studentId]/Profile360Overview.tsx");
  const styles = source("app/admin/alumnas/[studentId]/student-figures.module.css");
  const studentPortal = source("app/student/figuras/page.tsx");
  const studentFigureDetail = source("app/student/figuras/[slug]/page.tsx");
  const photoPicker = source("app/student/figuras/PoleFigurePhotoPicker.tsx");
  const studentActions = source("app/student/actions.ts");

  it("derives visible figures from the student's Pole technical level", () => {
    expect(panel).toContain('.from("student_discipline_levels")');
    expect(panel).toContain('.from("technical_level_definitions")');
    expect(panel).toContain('.from("pole_figure_profiles")');
    expect(panel).toContain("levelRank");
    expect(panel).toContain('currentLevelTitle = "Principiante"');
  });

  it("shows completed and pending states in the admin profile without primary completion actions", () => {
    expect(panel).toContain('.from("student_pole_figure_achievements")');
    expect(client).toContain('"completed"');
    expect(client).toContain('"pending"');
    expect(client).toContain("Hecha");
    expect(client).toContain("Pendiente");
    expect(client).not.toContain("Marcar hecha");
    expect(client).not.toContain("Mover a pendiente");
  });

  it("exposes figures inside the student operation profile", () => {
    expect(profile).toContain('"figures"');
    expect(profile).toContain("<StudentFiguresPanel");
    expect(overview).toContain('href("figures")');
    expect(overview).toContain("Figuras");
  });

  it("lets students upload photos only for achieved Pole figures", () => {
    expect(studentPortal).toContain("student_pole_figure_achievements");
    expect(studentPortal).toContain("PoleFigurePhotoPicker");
    expect(studentPortal).toContain("Cuando tu instructora la marque como hecha");
    expect(photoPicker).toContain('"pole-achievement-photos"');
    expect(studentActions).toContain("finalizeStudentPoleFigurePhotoAction");
    expect(studentActions).toContain("figure_not_achieved");
    expect(studentPortal).toContain("Tus siguientes figuras");
    expect(studentPortal).toContain("Bloqueadas");
    expect(studentFigureDetail).toContain("Tu camino hacia esta figura");
    expect(studentFigureDetail).toContain("Cuando la logres, se abren");
    expect(studentPortal).not.toContain("Ya la logré");
    expect(studentFigureDetail).not.toContain("Ya la logré");
  });

  it("uses Sendero visual tokens for the figures panel", () => {
    expect(styles).toContain("#8fe6c8");
    expect(styles).toContain('"Sendero Marcellus"');
    expect(styles).toContain("#2a2c33");
    expect(styles).toContain("@media (max-width: 760px)");
  });
});
