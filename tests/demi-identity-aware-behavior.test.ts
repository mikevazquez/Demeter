import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi identity-aware behavior", () => {
  const source = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");

  it("does not expose student package status to an unlinked prospect", () => {
    expect(source).toContain('tool.name !== "get_student_package_status"');
  });

  it("prevents Meta Inbox identity lookup from being called in WhatsApp", () => {
    expect(source).toContain("function isWhatsAppIdentityLookupBlocked");
    expect(source).toContain(
      "!isWhatsAppIdentityLookupBlocked(input.channel, tool.name)",
    );
  });

  it("includes student and prospect identity rules", () => {
    const phrases = [
      "En WhatsApp se resuelve por teléfono normalizado",
      "Studio Flow consultó su etapa actual al recibir este mensaje",
      "get_student_package_status",
      "contacto CRM sin una ficha de alumna",
      "Responde lo que pidió con la información oficial",
      "No lo adivines",
    ];

    for (const phrase of phrases) {
      expect(source).toContain(phrase);
    }
  });
});
