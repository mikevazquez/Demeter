import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const form = readFileSync("app/admin/actividades/programas/[programId]/EnrollmentForm.tsx", "utf8");
const css = readFileSync("app/admin/actividades/actividades.css", "utf8");

describe("workshop student search", () => {
  it("replaces the full student select with an accessible combobox", () => {
    expect(form).toContain('role="combobox"');
    expect(form).toContain('aria-autocomplete="list"');
    expect(form).toContain('role="listbox"');
    expect(form).toContain('role="option"');
    expect(form).not.toContain('<select name="student_id"');
  });

  it("requires a deliberate student selection before submitting", () => {
    expect(form).toContain('name="student_id"');
    expect(form).toContain('value={selectedStudent?.id ?? ""}');
    expect(form).toContain("disabled={pending || !selectedStudent}");
  });

  it("filters after two characters, normalizes accents and caps visible matches", () => {
    expect(form).toContain('.normalize("NFD")');
    expect(form).toContain("normalizedQuery.length < 2");
    expect(form).toContain(".slice(0, 8)");
    expect(form).toContain("includes(normalizedQuery)");
  });

  it("supports keyboard selection and escape", () => {
    expect(form).toContain('event.key === "ArrowDown"');
    expect(form).toContain('event.key === "ArrowUp"');
    expect(form).toContain('event.key === "Enter"');
    expect(form).toContain('event.key === "Escape"');
  });

  it("keeps results visually bounded and usable on mobile", () => {
    expect(css).toContain(".activities-combobox-results");
    expect(css).toContain("max-height: 280px");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-width: 760px)");
  });
});
