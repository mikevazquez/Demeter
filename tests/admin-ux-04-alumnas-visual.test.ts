import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { directoryHref, resolveDirectoryFilters } from "@/app/admin/alumnas/directory-filters";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 · P360-V2-07 Alumnas directory", () => {
  const page = source("app/admin/alumnas/page.tsx");
  const row = source("app/admin/alumnas/ContactRow.tsx");
  const styles = source("app/admin/alumnas/admin-ux-04.css");
  const v2Styles = source("app/admin/alumnas/profile-360-v2.css");
  const layout = source("app/admin/alumnas/layout.tsx");

  it("separates the person's state from what needs attention", () => {
    expect(page).toContain('aria-label="Estado"');
    expect(page).toContain('aria-label="Atención"');
    expect(page).toContain("DIRECTORY_STAGES.map");
    expect(page).not.toContain("student-directory-kpis");
    expect(page).not.toContain('aria-label="Entrada comercial"');
    expect(page).not.toContain('aria-label="Resumen de contactos"');
    expect(v2Styles).toContain(".p360v2-segment");
    expect(styles).toContain("@media (max-width: 760px)");
  });

  it("keeps old filter links working", () => {
    expect(resolveDirectoryFilters("active", undefined)).toEqual({
      stage: "student",
      attention: null,
    });
    expect(resolveDirectoryFilters("inactive", undefined).stage).toBe("former");
    expect(resolveDirectoryFilters("expiring", undefined)).toEqual({
      stage: "all",
      attention: "expiring",
    });
    expect(resolveDirectoryFilters("followup", undefined).attention).toBe("pending");
    expect(resolveDirectoryFilters("trial", "no_show")).toEqual({
      stage: "trial",
      attention: "no_show",
    });
    expect(resolveDirectoryFilters("<x>", "<y>")).toEqual({ stage: "all", attention: null });
    expect(directoryHref("student", "expired", "ana")).toBe(
      "/admin/alumnas?status=student&att=expired&q=ana",
    );
    expect(directoryHref("all", null, "")).toBe("/admin/alumnas");
  });

  it("surfaces real package context without changing business rules", () => {
    expect(page).toContain('from("product_acquisitions")');
    expect(page).toContain("currentAcquisitionFor");
    expect(page).toContain("productNameMap");
    expect(page).toContain("shortDate(acquisition.expires_on, studio.locale)");
    expect(page).toContain("canReadProducts");
  });

  it("shows one next step per person and puts pending people first", () => {
    expect(page).toContain("pendingFor(");
    expect(page).toContain("toneOrder[a.pending[0].tone]");
    expect(row).toContain("p360v2-next");
    expect(row).not.toContain("crm-message-cell");
  });

  it("keeps existing directory behaviors intact", () => {
    expect(page).toContain("action={createStudent}");
    expect(page).toContain("href={`/admin/alumnas/${student.id}`}");
    expect(page).toContain('name="q"');
    expect(page).toContain("directoryHref");
    expect(page).toContain("DuplicateStudentDialog");
    expect(page).toContain("StudentDeletedDialog");
  });

  it("keeps new-student creation at the top behind a compact plus action", () => {
    const quickCreateIndex = page.indexOf('id="alta-rapida"');
    const filtersIndex = page.indexOf('aria-label="Estado"');
    const directoryIndex = page.indexOf('<section className="panel">');

    expect(quickCreateIndex).toBeGreaterThan(0);
    expect(quickCreateIndex).toBeLessThan(filtersIndex);
    expect(quickCreateIndex).toBeLessThan(directoryIndex);
    expect(page).toContain('className="student-quick-create"');
    expect(page).toContain('aria-label="Nueva alumna"');
    expect(styles).toContain(".student-quick-create-panel");
    expect(styles).not.toContain("#alta-rapida.panel");
  });

  it("loads the P360-V2 layer after the existing Alumnas styles", () => {
    expect(layout).toContain('import "./profile-360.css";');
    expect(layout).toContain('import "./admin-ux-04.css";');
    expect(layout.indexOf('import "./admin-ux-04.css";')).toBeGreaterThan(
      layout.indexOf('import "./profile-360.css";'),
    );
    expect(layout.indexOf('import "./profile-360-v2.css";')).toBeGreaterThan(
      layout.indexOf('import "./sendero-alumnas.css";'),
    );
  });
});
