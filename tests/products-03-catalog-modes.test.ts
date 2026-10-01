import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const catalog = source("app/admin/productos/page.tsx");
const classList = source("app/admin/productos/por-clases/page.tsx");
const classPeriodList = source("app/admin/productos/por-clases/[period]/page.tsx");
const classForm = source("app/admin/productos/por-clases/CreateClassPackageForm.tsx");
const classActions = source("app/admin/productos/por-clases/actions.ts");
const restricted = source("app/admin/productos/por-disciplina-horario/page.tsx");
const restrictedForm = source(
  "app/admin/productos/por-disciplina-horario/CreateRestrictedPackageForm.tsx",
);
const restrictedActions = source("app/admin/productos/por-disciplina-horario/actions.ts");
const unlimitedForm = source("app/admin/productos/ilimitados/CreateUnlimitedForm.tsx");
const unlimitedActions = source("app/admin/productos/ilimitados/actions.ts");
const activityActions = source("app/admin/productos/cursos-talleres/actions.ts");

describe("PRODUCTS-03 V2 package catalog", () => {
  it("separates the catalog into the four approved studio-friendly blocks", () => {
    expect(catalog).toContain('title: "Por clases"');
    expect(catalog).toContain('title: "Por disciplina / horario"');
    expect(catalog).toContain('title: "Ilimitados"');
    expect(catalog).toContain('title: "Cursos y talleres"');
    expect(catalog).toContain('href: "/admin/productos/por-clases"');
    expect(catalog).toContain('href: "/admin/productos/por-disciplina-horario"');
    expect(catalog).toContain('href: "/admin/productos/ilimitados"');
    expect(catalog).toContain('href: "/admin/productos/cursos-talleres"');
  });

  it("keeps class packs simple and excludes restricted packages from that catalog", () => {
    expect(classList).toContain('from("product_template_disciplines")');
    expect(classList).toContain('from("product_template_schedules")');
    expect(classList).toContain("appliesToEveryActiveDiscipline");
    expect(classList).toContain("scheduleRestrictedProductIds.has(product.id)");
    expect(classPeriodList).toContain("!scheduleRestrictedProductIds.has(product.id)");
    expect(classForm).toContain('name="credit_limit"');
    expect(classForm).toContain('name="validity_days"');
    expect(classForm).toContain("Todas las disciplinas");
    expect(classForm).not.toContain('name="schedule_ids"');
  });

  it("separates discipline restrictions from exact schedule restrictions", () => {
    expect(restricted).toContain("<strong>Por disciplina</strong>");
    expect(restricted).toContain("<strong>Por horarios específicos</strong>");
    expect(restrictedForm).toContain('name="scope"');
    expect(restrictedForm).toContain('name="discipline_ids"');
    expect(restrictedForm).toContain('name="schedule_ids"');
    expect(restrictedActions).toContain('scopeRaw === "disciplina"');
    expect(restrictedActions).toContain('formData.getAll("schedule_ids")');
    expect(restrictedActions).toContain('from("product_template_schedules")');
  });

  it("keeps unlimited memberships credit-free", () => {
    expect(unlimitedForm).toContain("Acceso ilimitado");
    expect(unlimitedForm).toContain("Sin límite de créditos");
    expect(unlimitedForm).not.toContain('name="credit_limit"');
    expect(unlimitedActions).toContain('product_type: "membership"');
    expect(unlimitedActions).toContain("credit_limit: null");
    expect(unlimitedActions).toContain("unlimited: true");
  });

  it("supports the approved validity periods plus a custom duration", () => {
    expect(classActions).toContain("monthly: 30");
    expect(classActions).toContain("quarterly: 90");
    expect(classActions).toContain("semiannual: 180");
    expect(classActions).toContain("annual: 365");
    expect(unlimitedActions).toContain("monthly: 30");
    expect(unlimitedActions).toContain("quarterly: 90");
    expect(unlimitedActions).toContain("semiannual: 180");
    expect(unlimitedActions).toContain("annual: 365");
    expect(classList).toContain('key: "custom"');
    expect(classPeriodList).toContain('packageTerm: "custom"');
    expect(classForm).toContain("fixedValidity");
  });

  it("links course and workshop packages to a specific activity", () => {
    expect(activityActions).toContain('formData.get("activity_id")');
    expect(activityActions).toContain('from("product_template_activities")');
    expect(activityActions).toContain("class_template_id: activity.id");
  });
});
