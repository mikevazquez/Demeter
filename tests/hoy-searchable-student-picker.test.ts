import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Hoy searchable student picker", () => {
  it("uses name search instead of a long select for existing students", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");

    expect(operations).toContain('placeholder="Buscar alumna por nombre"');
    expect(operations).toContain("matchingCandidates");
    expect(operations).toContain("normalizeSearch");
    expect(operations).not.toContain('<select name="student_id"');
  });

  it("requires choosing a matching student before adding", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");

    expect(operations).toContain('name="student_id" value={selectedStudentId}');
    expect(operations).toContain("disabled={!selectedStudentId}");
  });
});
