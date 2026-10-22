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
    (entry) =>
      input.addons.includes(entry.key) &&
      !plan.includedModules.includes(entry.key) &&
      entry.monthlyPriceMxn !== null,
  ).reduce((sum, entry) => sum + (entry.monthlyPriceMxn ?? 0), 0);
  const total = plan.monthlyPriceMxn + extras;
  return input.foundingAlumni
    ? Math.round((total * (100 - PLATFORM_SETTINGS.foundingDiscountPct)) / 100)
    : total;
}

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function formatMxn(amount: number): string {
  return MXN.format(amount);
}

/** Texto corto del precio de un módulo suelto (Demi: configuración + cuota pendiente). */
export function modulePriceLabel(moduleKey: PlatformModuleKey): string {
  const entry = PLATFORM_MODULES.find((item) => item.key === moduleKey);
  if (!entry) return "";
  if (moduleKey === "demi") {
    return `configuración ${formatMxn(entry.setupPriceMxn ?? 0)} + cuota mensual`;
  }
  return `${formatMxn(entry.monthlyPriceMxn ?? 0)} al mes`;
}

export type ModuleActivationQuote = {
  moduleKey: PlatformModuleKey;
  modulePriceMxn: number | null;
  setupPriceMxn: number | null;
  monthlyBeforeMxn: number;
  monthlyAfterMxn: number;
  /** Plan que incluye todo lo que tendría y sale más barato que sumar módulos sueltos. */
  suggestedPlan: { key: PlatformPlanKey; label: string; monthlyPriceMxn: number } | null;
};

/** NEB-01-03/34 · Cuánto pagaría el estudio si activa el módulo y si le conviene un plan. */
export function moduleActivationQuote(input: {
  plan: PlatformPlanKey;
  activeModules: PlatformModuleKey[];
  foundingAlumni: boolean;
  moduleKey: PlatformModuleKey;
}): ModuleActivationQuote {
  const plan = platformPlan(input.plan);
  const entry = PLATFORM_MODULES.find((item) => item.key === input.moduleKey);
  const addons = input.activeModules.filter((key) => !plan.includedModules.includes(key));
  const before = monthlyPriceMxn({
    plan: plan.key,
    addons,
    foundingAlumni: input.foundingAlumni,
  });
  const after = monthlyPriceMxn({
    plan: plan.key,
    addons: [...addons, input.moduleKey],
    foundingAlumni: input.foundingAlumni,
  });
  const wanted = [...new Set([...input.activeModules, input.moduleKey])].filter(
    (key) => key !== "demi",
  );
  let suggestedPlan: ModuleActivationQuote["suggestedPlan"] = null;
  if (plan.key !== "founding" && plan.key !== "allaccess") {
    for (const candidate of PLATFORM_PLANS) {
      if (!candidate.sellable || candidate.key === "founding" || candidate.key === plan.key)
        continue;
      if (!wanted.every((key) => candidate.includedModules.includes(key))) continue;
      const price = monthlyPriceMxn({
        plan: candidate.key,
        addons: [],
        foundingAlumni: input.foundingAlumni,
      });
      if (price < after && (!suggestedPlan || price < suggestedPlan.monthlyPriceMxn)) {
        suggestedPlan = { key: candidate.key, label: candidate.label, monthlyPriceMxn: price };
      }
    }
  }
  return {
    moduleKey: input.moduleKey,
    modulePriceMxn: entry?.monthlyPriceMxn ?? null,
    setupPriceMxn: entry?.setupPriceMxn ?? null,
    monthlyBeforeMxn: before,
    monthlyAfterMxn: after,
    suggestedPlan,
  };
}
