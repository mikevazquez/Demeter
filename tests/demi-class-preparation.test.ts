import { describe, expect, it } from "vitest";
import { preparationFromStudioPrompt } from "../lib/assistant/class-preparation";

const disciplines = [{ name: "Exotic Pole" }, { name: "Heels" }];
describe("explicit preparation in the active studio prompt", () => {
  it("keeps each discipline's clothing and excludes old operational data", () => {
    const text =
      "Exotic Pole — palabra clave: EXPRESIÓN\n\t•\tQué es: baile.\n\t•\tQué llevar: rodilleras y ropa cómoda.\n\t•\tCupo: 9.\nHeels — palabra clave: ACTITUD\n• Qué llevar: tacones.\n9. PRECIOS\nClase: $100";
    expect(preparationFromStudioPrompt(text, disciplines)).toBe(
      "Exotic Pole: rodilleras y ropa cómoda.\nHeels: tacones.",
    );
    expect(preparationFromStudioPrompt(text.replace(/\n/g, "\\n"), disciplines)).toBe(
      "Exotic Pole: rodilleras y ropa cómoda.\nHeels: tacones.",
    );
  });
  it("does not invent preparation or include inactive disciplines", () => {
    expect(
      preparationFromStudioPrompt(
        "Exotic Pole — baile\n• Qué es: sensual.\nYoga — calma\n• Qué llevar: agua.",
        disciplines,
      ),
    ).toBeNull();
  });
  it("does not assign an unrelated section to the previous discipline", () => {
    expect(
      preparationFromStudioPrompt("Exotic Pole\n8. HORARIOS\nQué llevar: un regalo.", disciplines),
    ).toBeNull();
  });
});
