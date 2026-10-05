import { describe, expect, it } from "vitest";

import {
  canSearchStudents,
  canSelectStudentCandidate,
  hasSelectedStudent,
  normalizeStudentSearch,
} from "../lib/admin/student-picker";

describe("Hoy searchable student picker", () => {
  it("uses name search instead of a long select for existing students", () => {
    expect(normalizeStudentSearch("  María Núñez ")).toBe("maria nunez");
    expect(canSearchStudents(" A ")).toBe(false);
    expect(canSearchStudents(" Ma ")).toBe(true);
  });

  it("requires choosing a matching student before adding", () => {
    expect(canSelectStudentCandidate({ eligible: false, detail: "sin paquete activo" })).toBe(true);
    expect(canSelectStudentCandidate({ eligible: false, detail: "clase llena" })).toBe(false);
    expect(hasSelectedStudent("  ")).toBe(false);
    expect(hasSelectedStudent("student-123")).toBe(true);
  });
});
