import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 Alumnas visual homologation", () => {
  const page = source("app/admin/alumnas/page.tsx");
  const styles = source("app/admin/alumnas/admin-ux-04.css");
  const layout = source("app/admin/layout.tsx");

  it("uses the approved Alumnas visual hierarchy", () => {
    expect(page).toContain("student-directory-kpis");
    expect(page).toContain("Alumnas activas");
    expect(page).toContain("Por vencer · 7 días");
    expect(page).toContain("Vencidas");
    expect(page).toContain("Total");
    expect(styles).toContain(".student-directory-kpis");
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("surfaces real package context without changing business rules", () => {
    expect(page).toContain('from("product_acquisitions")');
    expect(page).toContain("currentAcquisitionFor");
    expect(page).toContain("productNameMap");
    expect(page).toContain("shortDate(acquisition.expires_on)");
    expect(page).toContain("canReadProducts");
  });

  it("supports package-status filters for expiring and expired students", () => {
    expect(page).toContain('"expiring", "expired"');
    expect(page).toContain('{ key: "expiring", label: "Por vencer", enabled: canReadProducts }');
    expect(page).toContain('{ key: "expired", label: "Vencidas", enabled: canReadProducts }');
    expect(page).toContain('status === "expiring"');
    expect(page).toContain('status === "expired"');
    expect(page).toContain("filteredStudents");
  });

  it("keeps existing directory behaviors intact", () => {
    expect(page).toContain("action={createStudent}");
    expect(page).toContain("href={`/admin/alumnas/${student.id}`}");
    expect(page).toContain('name="q"');
    expect(page).toContain("filterHref");
    expect(page).toContain("DuplicateStudentDialog");
    expect(page).toContain("StudentDeletedDialog");
  });

  it("keeps new-student creation at the top behind a compact plus action", () => {
    const quickCreateIndex = page.indexOf('id="alta-rapida"');
    const kpiIndex = page.indexOf('className="student-directory-kpis"');
    const directoryIndex = page.indexOf('<section className="panel">');

    expect(quickCreateIndex).toBeGreaterThan(0);
    expect(quickCreateIndex).toBeLessThan(kpiIndex);
    expect(quickCreateIndex).toBeLessThan(directoryIndex);
    expect(page).toContain('className="student-quick-create"');
    expect(page).toContain('aria-label="Nueva alumna"');
    expect(styles).toContain(".student-quick-create-panel");
    expect(styles).not.toContain("#alta-rapida.panel");
  });

  it("loads the homologation layer after the existing Profile 360 styles", () => {
    expect(layout).toContain('import "./alumnas/profile-360.css";');
    expect(layout).toContain('import "./alumnas/admin-ux-04.css";');
    expect(layout.indexOf('import "./alumnas/admin-ux-04.css";')).toBeGreaterThan(
      layout.indexOf('import "./alumnas/profile-360.css";'),
    );
  });
});
