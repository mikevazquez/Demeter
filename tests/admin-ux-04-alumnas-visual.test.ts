import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const source = (path: string) => readFileSync(path, "utf8");
describe("Alumnas reference CRM", () => {
  const page = source("app/admin/alumnas/page.tsx");
  const board = source("app/admin/alumnas/CrmBoard.tsx");
  it("groups the four person states and actionable stages", () => {
    for (const label of [
      "Prospecto",
      "Prueba",
      "Alumna",
      "Exalumna",
      "Por vencer",
      "Pago pendiente",
      "No show",
      "Sin paquete",
    ])
      expect(board).toContain(label);
    expect(page).toContain("<CrmBoard");
  });
  it("reads package, enrollment and pending-transfer context", () => {
    for (const table of [
      "product_acquisitions",
      "student_enrollments",
      "assistant_transfer_purchase_intents",
      "reservations",
    ])
      expect(page).toContain(`from("${table}")`);
    expect(page).toContain("resolveEnrollmentStatus");
  });
  it("searches live ignoring accents and spaces and retains the selected state", () => {
    expect(board).toContain("normalized(p.name + p.phone)");
    expect(board).toContain("sf-funnel");
    expect(board).toContain("useSyncExternalStore");
  });
  it("retains creation and duplicate safeguards", () => {
    expect(page).toContain("action={createStudent}");
    expect(page).toContain("DuplicateStudentDialog");
    expect(page).toContain("StudentDeletedDialog");
    expect(page).toContain('aria-label="Nueva alumna"');
    expect(board).toContain("href={p.href}");
  });
  it("keeps mobile columns within their scrolling board", () => {
    expect(source("app/admin/portal.css")).toContain(".portal-crm-board");
    expect(board).toContain("portal-crm-states");
  });
  it("loads profile styles before their administrative overrides", () => {
    const layout = source("app/admin/alumnas/layout.tsx");
    expect(layout.indexOf('import "./admin-ux-04.css"')).toBeGreaterThan(
      layout.indexOf('import "./profile-360.css"'),
    );
  });
});
