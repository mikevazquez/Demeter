import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Demi prospect sales guidance", () => {
  const source = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");

  it("selects first visit guidance from the resolved lifecycle", () => {
    expect(source).toContain("needsFirstVisitGuidance(input)");
    expect(source).toContain("asesora comercial consultiva");
    expect(source).toContain("sin presionar");
    expect(source).toContain("Contesta primero lo que preguntó");
  });

  it("preserves conversation context and uses current Studio Flow data", () => {
    expect(source).toContain("como máximo una pregunta por mensaje");
    expect(source).toContain("no vuelvas a pedir información que ya proporcionó");
    expect(source).toContain("get_activity_catalog");
    expect(source).toContain("actividades activas");
    expect(source).toContain("opciones vigentes de Studio Flow");
    expect(source).toContain("No uses listas memorizadas");
    expect(source).toContain("Nunca prometas disponibilidad sin buscarla");
  });

  it("moves booking intent forward without redundant questions", () => {
    expect(source).toContain("ofrece hasta 2 o 3 próximas clases disponibles");
    expect(source).toContain(
      "No preguntes de nuevo la disciplina, fecha u horario si ya están claros",
    );
    expect(source).toContain("No presentes todos los paquetes si no lo pidió");
  });
});
