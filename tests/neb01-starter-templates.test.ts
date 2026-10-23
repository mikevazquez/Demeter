import { describe, expect, it } from "vitest";

import { STARTER_TEMPLATES, starterTemplate, starterTemplatePayload } from "@/lib/platform/starter-templates";

describe("NEB-01-15 plantillas de arranque", () => {
  it("trae las cuatro plantillas acordadas", () => {
    expect(STARTER_TEMPLATES.map((template) => template.key)).toEqual([
      "pole_aereos",
      "yoga",
      "pilates",
      "baile",
    ]);
    expect(starterTemplate("nada")).toBeNull();
  });

  it("cada paquete cumple las reglas de la base", () => {
    for (const template of STARTER_TEMPLATES) {
      const names = new Set<string>();
      for (const product of template.products) {
        expect(names.has(product.name)).toBe(false);
        names.add(product.name);
        expect(product.priceMinor).toBeGreaterThan(0);
        if (product.productType === "enrollment") {
          expect(product.creditLimit).toBeNull();
          expect(product.unlimited).toBe(false);
          expect(product.packageTerm).toBeNull();
        } else {
          expect(product.validityDays).toBeGreaterThan(0);
          expect(product.unlimited ? product.creditLimit === null : (product.creditLimit ?? 0) > 0).toBe(true);
          expect(["package", "membership"].includes(product.productType) ? product.packageTerm : null).toBe(
            ["package", "membership"].includes(product.productType) ? "monthly" : null,
          );
        }
      }
      for (const activity of template.activities) {
        expect(template.disciplines).toContain(activity.discipline);
        expect(activity.colorHex).toMatch(/^#[0-9A-F]{6}$/i);
        expect(activity.durationMinutes).toBeGreaterThanOrEqual(15);
        expect(activity.capacity).toBeGreaterThan(0);
      }
      for (const slot of template.schedule) {
        expect(template.activities.some((activity) => activity.name === slot.activity)).toBe(true);
      }
    }
  });

  it("lo que viaja a la base no incluye el horario", () => {
    const payload = starterTemplatePayload(STARTER_TEMPLATES[0]);
    expect(Object.keys(payload).sort()).toEqual(["activities", "disciplines", "key", "products"]);
    expect(payload.products[0]).toHaveProperty("price_minor");
  });
});
