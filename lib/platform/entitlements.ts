import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BrandLevel,
  PlatformModuleKey,
  PlatformPlanKey,
  StudioSubscriptionStatus,
} from "./catalog";

// NEB-01-02 · Derechos de un estudio según su plan, módulos y estado de pago.
export type StudioEntitlements = {
  studioId: string;
  plan: PlatformPlanKey;
  planLabel: string;
  status: StudioSubscriptionStatus;
  brandLevel: BrandLevel;
  canOperate: boolean;
  monthlyPriceMxn: number;
  foundingAlumni: boolean;
  foundingStartedOn: string | null;
  foundingEndsOn: string | null;
  cutDay: number | null;
  modules: Record<PlatformModuleKey, boolean>;
};

type RawEntitlements = {
  studio_id: string;
  plan: PlatformPlanKey;
  plan_label: string;
  status: StudioSubscriptionStatus;
  brand_level: BrandLevel;
  can_operate: boolean;
  monthly_price_mxn: number;
  founding_alumni: boolean;
  founding_started_on: string | null;
  founding_ends_on: string | null;
  cut_day: number | null;
  modules: Record<PlatformModuleKey, boolean>;
};

export function parseEntitlements(raw: RawEntitlements): StudioEntitlements {
  return {
    studioId: raw.studio_id,
    plan: raw.plan,
    planLabel: raw.plan_label,
    status: raw.status,
    brandLevel: raw.brand_level,
    canOperate: raw.can_operate,
    monthlyPriceMxn: raw.monthly_price_mxn,
    foundingAlumni: raw.founding_alumni,
    foundingStartedOn: raw.founding_started_on,
    foundingEndsOn: raw.founding_ends_on,
    cutDay: raw.cut_day,
    modules: {
      recompensas: Boolean(raw.modules?.recompensas),
      recursos: Boolean(raw.modules?.recursos),
      catalogo: Boolean(raw.modules?.catalogo),
      demi: Boolean(raw.modules?.demi),
    },
  };
}

/**
 * Lee los derechos del estudio. Si la migración aún no está aplicada (Sandbox o producción
 * sin NEB-01), regresa null y la app debe comportarse como hoy (sin bloquear nada).
 */
export async function loadStudioEntitlements(
  supabase: SupabaseClient,
  studioId: string,
): Promise<StudioEntitlements | null> {
  const { data, error } = await supabase.rpc("studio_entitlements", { p_studio: studioId });
  if (error || !data) return null;
  return parseEntitlements(data as RawEntitlements);
}

export function studioHasModule(
  entitlements: StudioEntitlements | null,
  module: PlatformModuleKey,
): boolean {
  // Sin datos de Nébora todavía: no bloquear (comportamiento actual).
  if (!entitlements) return true;
  return entitlements.modules[module];
}

export async function isPlatformAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("platform_is_admin");
  return !error && data === true;
}
