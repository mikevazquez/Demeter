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

/** Para procesos del servidor con service_role (webhook de Demi). null = sin datos, no bloquear. */
export async function loadStudioEntitlementsService(
  serviceClient: SupabaseClient,
  studioId: string,
): Promise<StudioEntitlements | null> {
  const { data, error } = await serviceClient.rpc("platform_studio_entitlements_service", {
    p_studio: studioId,
  });
  if (error || !data) return null;
  return parseEntitlements(data as RawEntitlements);
}

export const MODULE_LABEL: Record<PlatformModuleKey, string> = {
  recompensas: "Recompensas",
  recursos: "Recursos y mapa",
  catalogo: "Catálogo y evaluaciones",
  demi: "Demi",
};

/** Aviso de suscripción para el admin del estudio; null cuando no hay nada que avisar. */
export function subscriptionNotice(entitlements: StudioEntitlements | null): string | null {
  switch (entitlements?.status) {
    case "grace":
      return "Hay un pago pendiente de tu suscripción. Regularízalo dentro de los 7 días de gracia para seguir vendiendo y reservando.";
    case "read_only":
      return "Tu estudio está en solo lectura por un pago pendiente: puedes consultar todo, pero no vender ni reservar hasta pagar.";
    case "suspended":
      return "Tu estudio está suspendido. Escríbenos a Nébora para reactivarlo.";
    default:
      return null;
  }
}

/** Mensaje para errores que vienen de los bloqueos de la base (NEB-01-03). */
export function entitlementErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.includes("module_not_contracted"))
    return "Este módulo no está incluido en el plan del estudio.";
  if (message.includes("studio_read_only"))
    return "El estudio está en solo lectura por un pago pendiente; no se puede vender ni reservar.";
  return null;
}
