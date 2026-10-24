import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legacyForm = readFileSync(
  "app/admin/actividades/programas/[programId]/EnrollmentForm.tsx",
  "utf8",
);
const activeWorkshopForm = readFileSync(
  "app/admin/actividades/talleres/[offerId]/WorkshopPurchaseForm.tsx",
  "utf8",
);
const css = readFileSync("app/admin/actividades/actividades.css", "utf8");

describe("workshop student search", () => {
  it("also keeps the legacy program selector searchable", () => {
    expect(legacyForm).toContain('role="combobox"');
    expect(legacyForm).not.toContain('<select name="student_id"');
  });

  it("replaces the active workshop student select with an accessible combobox", () => {
    expect(activeWorkshopForm).toContain('role="combobox"');
    expect(activeWorkshopForm).toContain('aria-autocomplete="list"');
    expect(activeWorkshopForm).toContain('role="listbox"');
    expect(activeWorkshopForm).toContain('role="option"');
    expect(activeWorkshopForm).not.toContain('<select name="student_id"');
    expect(activeWorkshopForm).toContain('name="student_id"');
  });

  it("requires a deliberate student selection before submitting", () => {
    expect(activeWorkshopForm).toContain('name="student_id"');
    expect(activeWorkshopForm).toContain('name="student_id"');
    expect(activeWorkshopForm).toContain('value={studentId}');
    expect(activeWorkshopForm).toContain("disabled={pending || !amountValid || !studentId}");
  });

  it("filters after two characters, normalizes accents and caps visible matches", () => {
    expect(activeWorkshopForm).toContain('.normalize("NFD")');
    expect(activeWorkshopForm).toContain("normalizedQuery.length < 2");
    expect(activeWorkshopForm).toContain(".slice(0, 8)");
    expect(activeWorkshopForm).toContain("includes(normalizedQuery)");
  });

  it("supports keyboard selection and escape in the active workshop flow", () => {
    expect(activeWorkshopForm).toContain('event.key === "ArrowDown"');
    expect(activeWorkshopForm).toContain('event.key === "ArrowUp"');
    expect(activeWorkshopForm).toContain('event.key === "Enter"');
    expect(activeWorkshopForm).toContain('event.key === "Escape"');
  });

  it("keeps results visually bounded and usable on mobile", () => {
    expect(css).toContain(".activities-combobox-results");
    expect(css).toContain("max-height: 280px");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-width: 760px)");
  });
});
