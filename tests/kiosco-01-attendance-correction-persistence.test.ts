import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("KIOSCO-01 attendance correction persistence", () => {
  it("verifies the RPC result before claiming a completed correction", () => {
    const actions = source("app/admin/actions.ts");

    expect(actions).toContain("attendanceResult");
    expect(actions).toContain('"set_attendance_status"');
    expect(actions).toContain("result.status !== status");
    expect(actions).toContain("(reason && result.changed !== true)");
    expect(actions).toContain("attendance_not_persisted");
  });

  it("re-reads the reservation status after the mutation", () => {
    const actions = source("app/admin/actions.ts");

    expect(actions).toContain('.from("reservations")');
    expect(actions).toContain('.select("status")');
    expect(actions).toContain("persisted?.status !== status");
  });

  it("shows an explicit error when the correction did not persist", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");

    expect(operations).toContain('error === "attendance_not_persisted"');
    expect(operations).toContain("La corrección no se guardó. Intenta nuevamente.");
  });
});
