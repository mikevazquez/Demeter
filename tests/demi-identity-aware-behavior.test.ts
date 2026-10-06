import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi identity-aware behavior", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/assistant/orchestrator.ts"),
    "utf8",
  );

  it("treats identified students as students", () => {
    expect(source).toContain("Identidad confirmada por Studio Flow: esta persona es ALUMNA");
    expect(source).toContain("No la trates como prospecto");
  });

  it(
    "treats CRM-only contacts as prospects and answers commercial questions from live tools",
    () => {
      expect(source).toContain("esta persona es PROSPECTO");
      expect(source).toContain("Responde de forma completa y útil todo lo que solicite");
      expect(source).toContain(
        "horarios, disponibilidad, precios, paquetes, ubicación y políticas",
      );
      expect(source).toContain("usando las herramientas reales");
    },
  );

  it("does not guess when identity is unresolved", () => {
    expect(source).toContain("Studio Flow no pudo confirmar si esta persona es alumna o prospecto");
    expect(source).toContain("No lo adivines");
  });
});
