import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi student package status", () => {
  const contracts = source("lib/assistant/tool-contracts.ts");
  const reads = source("lib/assistant/read-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("exposes a dedicated read tool for balance and validity questions", () => {
    expect(contracts).toContain('name: "get_student_package_status"');
    expect(contracts).toContain("cuántas clases le quedan");
    expect(reads).toContain('case "get_student_package_status"');
    expect(reads).toContain("getStudentPackageStatus");
  });

  it("scopes package reads to the identified student and studio", () => {
    expect(reads).toContain('.eq("studio_id", ctx.studio.id)');
    expect(reads).toContain('.eq("student_id", ctx.studentId)');
    expect(reads).toContain('.eq("status", "active")');
    expect(reads).toContain("credit_ledger");
    expect(reads).toContain("available_credits");
    expect(reads).toContain("expires_on");
  });

  it("keeps balance and validity questions inside Studio Flow instead of human handoff", () => {
    expect(orchestrator).toContain(
      "llama get_student_package_status antes de responder",
    );
    expect(orchestrator).toContain(
      "no escales a atención humana solo por pedir saldo o vigencia",
    );
  });
});
