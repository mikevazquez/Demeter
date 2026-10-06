import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi identity-aware behavior", () => {
  const source = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");

  it("includes student and prospect identity rules", () => {
    const phrases = [
      "esta persona es ALUMNA",
      "No la trates como prospecto",
      "esta persona es PROSPECTO",
      "Responde de forma completa y útil todo lo que solicite",
      "usando las herramientas reales",
      "No lo adivines",
    ];

    for (const phrase of phrases) {
      expect(source).toContain(phrase);
    }
  });
});
