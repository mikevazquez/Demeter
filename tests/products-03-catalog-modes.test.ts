import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const catalog = readFileSync(join(process.cwd(), "app/admin/productos/page.tsx"), "utf8");
const createPage = readFileSync(join(process.cwd(), "app/admin/productos/nuevo/page.tsx"), "utf8");
const fields = readFileSync(
  join(process.cwd(), "app/admin/productos/product-form-fields.tsx"),
  "utf8",
);
const actions = readFileSync(join(process.cwd(), "app/admin/productos/actions.ts"), "utf8");

describe("PRODUCTS-03 catalog modes", () => {
  it("separates the catalog into the four studio-friendly blocks", () => {
    expect(catalog).toContain("Paquetes por clases");
    expect(catalog).toContain("Paquetes restringidos");
    expect(catalog).toContain("Membresías ilimitadas");
    expect(catalog).toContain("Otros productos");
  });

  it("classifies unlimited and schedule-restricted products from existing rules", () => {
    expect(catalog).toContain('if (isPackageLike && product.unlimited)');
    expect(catalog).toContain("product.product_template_schedules?.length");
  });

  it("offers a creation mode before showing the product form", () => {
    expect(createPage).toContain("¿Qué quieres crear?");
    expect(createPage).toContain('creationMode={mode}');
  });

  it("locks simple packs to credits plus validity and restricted packs to schedules", () => {
    expect(fields).toContain('creationMode === "class_pack"');
    expect(fields).toContain('creationMode === "restricted_pack"');
    expect(fields).toContain('name="schedule_scope" value="all"');
    expect(fields).toContain('"specific" : scheduleScope');
  });

  it("keeps unlimited memberships credit-free", () => {
    expect(fields).toContain('creationMode === "unlimited_membership"');
    expect(fields).toContain('name="unlimited" value="on"');
    expect(fields).toContain("hidesCreditLimit");
  });

  it("supports a native one-week validity preset", () => {
    expect(fields).toContain('value="weekly"');
    expect(fields).toContain("weekly: 7");
    expect(actions).toContain('"weekly"');
    expect(actions).toContain("weekly: 7");
  });
});
