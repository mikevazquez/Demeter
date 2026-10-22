// NEB-01-02 · Catálogo comercial de Nébora (MXN, IVA incluido). Debe coincidir con la
// migración 20261022211000_neb01_plans_modules_entitlements.sql; tests/neb01-catalog.test.ts lo vigila.

export type PlatformModuleKey = "recompensas" | "recursos" | "catalogo" | "demi";
export type PlatformPlanKey = "core" | "growth" | "pro" | "founding" | "allaccess";
export type BrandLevel = "powered" | "full";
export type StudioSubscriptionStatus =
  "invited" | "active" | "grace" | "read_only" | "suspended" | "internal";

export type PlatformModule = {
  key: PlatformModuleKey;
  label: string;
  monthlyPriceMxn: number | null;
  setupPriceMxn: number | null;
};

export type PlatformPlan = {
  key: PlatformPlanKey;
  label: string;
  monthlyPriceMxn: number;
  setupPriceMxn: number;
  includedModules: PlatformModuleKey[];
  brandLevel: BrandLevel;
  sellable: boolean;
};

export const PLATFORM_MODULES: PlatformModule[] = [
  { key: "recompensas", label: "Recompensas", monthlyPriceMxn: 299, setupPriceMxn: null },
  { key: "recursos", label: "Recursos y mapa", monthlyPriceMxn: 299, setupPriceMxn: null },
  { key: "catalogo", label: "Catálogo y evaluaciones", monthlyPriceMxn: 299, setupPriceMxn: null },
  // La cuota mensual de Demi se fija después de medir su costo real (NEB-01-21/22).
  { key: "demi", label: "Demi · WhatsApp con IA", monthlyPriceMxn: null, setupPriceMxn: 2999 },
];

export const PLATFORM_PLANS: PlatformPlan[] = [
  {
    key: "core",
    label: "Core",
    monthlyPriceMxn: 899,
    setupPriceMxn: 1500,
    includedModules: [],
    brandLevel: "powered",
    sellable: true,
  },
  {
    key: "growth",
    label: "Growth",
    monthlyPriceMxn: 1399,
    setupPriceMxn: 2500,
    includedModules: ["recompensas", "recursos"],
    brandLevel: "powered",
    sellable: true,
  },
  {
    key: "pro",
    label: "Pro",
    monthlyPriceMxn: 1999,
    setupPriceMxn: 3500,
    includedModules: ["recompensas", "recursos", "catalogo"],
    brandLevel: "full",
    sellable: true,
  },
  {
    key: "founding",
    label: "Founding",
    monthlyPriceMxn: 899,
    setupPriceMxn: 0,
    includedModules: ["recompensas", "recursos", "catalogo"],
    brandLevel: "full",
    sellable: true,
  },
  {
    key: "allaccess",
    label: "All Access",
    monthlyPriceMxn: 0,
    setupPriceMxn: 0,
    includedModules: ["recompensas", "recursos", "catalogo", "demi"],
    brandLevel: "full",
    sellable: false,
  },
];

export const PLATFORM_SETTINGS = {
  foundingSeats: 5,
  foundingMonths: 12,
  foundingDiscountPct: 30,
  graceDays: 7,
} as const;

export function platformPlan(key: PlatformPlanKey): PlatformPlan {
  const plan = PLATFORM_PLANS.find((item) => item.key === key);
  if (!plan) throw new Error(`plan_invalid:${key}`);
  return plan;
}

/** Mensualidad a Nébora, igual que private.studio_monthly_price_mxn (sin cuota de Demi). */
export function monthlyPriceMxn(input: {
  plan: PlatformPlanKey;
  addons: PlatformModuleKey[];
  foundingAlumni: boolean;
}): number {
  const plan = platformPlan(input.plan);
  if (plan.key === "allaccess") return 0;
  if (plan.key === "founding") return plan.monthlyPriceMxn;
  const extras = PLATFORM_MODULES.filter(
    (module) =>
      input.addons.includes(module.key) &&
      !plan.includedModules.includes(module.key) &&
      module.monthlyPriceMxn !== null,
  ).reduce((sum, module) => sum + (module.monthlyPriceMxn ?? 0), 0);
  const total = plan.monthlyPriceMxn + extras;
  return input.foundingAlumni
    ? Math.round((total * (100 - PLATFORM_SETTINGS.foundingDiscountPct)) / 100)
    : total;
}
