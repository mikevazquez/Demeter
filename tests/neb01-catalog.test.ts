import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PLATFORM_MODULES, PLATFORM_PLANS, monthlyPriceMxn } from "../lib/platform/catalog";

const plans = readFileSync(
  new URL(
    "../supabase/migrations/20261022211000_neb01_plans_modules_entitlements.sql",
    import.meta.url,
  ),
  "utf8",
);
const audit = readFileSync(
  new URL("../supabase/migrations/20261022210000_neb01_platform_admins_audit.sql", import.meta.url),
  "utf8",
);

describe("NEB-01-02 catálogo comercial", () => {
  it("los precios de la app coinciden con la migración", () => {
    for (const plan of PLATFORM_PLANS) {
      const modules = plan.includedModules.length ? `{${plan.includedModules.join(",")}}` : "{}";
      expect(plans).toContain(
        `('${plan.key}', '${plan.label}', ${plan.monthlyPriceMxn}, ${plan.setupPriceMxn}, '${modules}', '${plan.brandLevel}', ${plan.sellable},`,
      );
    }
    for (const module of PLATFORM_MODULES) {
      expect(plans).toContain(
        `('${module.key}', '${module.label}', ${module.monthlyPriceMxn ?? "null"}, ${module.setupPriceMxn ?? "null"},`,
      );
    }
  });

  it("calcula la mensualidad como la base de datos", () => {
    expect(monthlyPriceMxn({ plan: "growth", addons: [], foundingAlumni: false })).toBe(1399);
    expect(monthlyPriceMxn({ plan: "growth", addons: ["catalogo"], foundingAlumni: false })).toBe(
      1698,
    );
    expect(monthlyPriceMxn({ plan: "growth", addons: [], foundingAlumni: true })).toBe(979);
    expect(
      monthlyPriceMxn({ plan: "core", addons: ["recompensas", "demi"], foundingAlumni: false }),
    ).toBe(1198);
    expect(monthlyPriceMxn({ plan: "founding", addons: ["catalogo"], foundingAlumni: false })).toBe(
      899,
    );
    expect(monthlyPriceMxn({ plan: "allaccess", addons: [], foundingAlumni: false })).toBe(0);
  });

  it("existentes nacen All Access y las escrituras son solo de plataforma", () => {
    expect(plans).toContain("select s.id, 'allaccess', 'internal' from public.studios s");
    expect(plans).toContain("raise exception 'founding_seats_full'");
    expect(plans.match(/perform private\.platform_require_admin\(\);/g)?.length).toBe(3);
  });

  it("la bitácora de plataforma es inmutable", () => {
    expect(audit).toContain("before update or delete on public.platform_audit_log");
    expect(audit).toContain("raise exception 'platform_audit_immutable'");
  });
});
