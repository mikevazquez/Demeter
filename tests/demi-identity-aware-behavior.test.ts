import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi identity-aware behavior", () => {
  const source = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");

  it("includes student and prospect identity rules", () => {
    const phrases = [
      "número de teléfono normalizado es el identificador único",
      "Studio Flow consultó su etapa actual al recibir este mensaje",
      "get_student_package_status",
      "contacto CRM sin una ficha de alumna",
      "responde lo que pidió con la información oficial",
      "No lo adivines",
    ];

    for (const phrase of phrases) {
      expect(source).toContain(phrase);
    }
  });
});
