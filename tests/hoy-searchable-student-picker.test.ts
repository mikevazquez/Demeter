import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Hoy searchable student picker", () => {
  it("uses name search instead of a long select for existing students", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");
    const picker = source("app/admin/hoy/ExistingStudentAddForm.tsx");

    expect(operations).toContain("ExistingStudentAddForm");
    expect(picker).toContain('placeholder="Buscar alumna por nombre"');
    expect(picker).toContain("matches");
    expect(picker).toContain("normalizeSearch");
    expect(picker).not.toContain('<select name="student_id"');
  });

  it("requires choosing a matching student before adding", () => {
    const picker = source("app/admin/hoy/ExistingStudentAddForm.tsx");

    expect(picker).toContain('name="student_id" value={selectedStudentId}');
    expect(picker).toContain("disabled={!selectedStudentId}");
  });
});
