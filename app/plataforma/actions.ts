"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PLATFORM_MODULES, PLATFORM_PLANS } from "@/lib/platform/catalog";
import { parsePriceMxnToMinor } from "@/lib/platform/support";
import { supportRequestErrorCode } from "@/lib/platform/support-requests";
import { createClient } from "@/lib/supabase/server";

// NEB-01-12 · Acciones de la consola. La base de datos valida que quien llama sea
// plataforma (platform_require_admin) y deja todo en la bitácora.

const KNOWN_ERRORS = [
  "forbidden",
  "founding_seats_full",
  "plan_invalid",
  "module_invalid",
  "status_invalid",
  "studio_not_found",
  "cut_day_invalid",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["invited", "active", "grace", "read_only", "suspended"];

function studioIdFrom(formData: FormData): string {
  const studioId = String(formData.get("studio") ?? "");
  if (!UUID.test(studioId)) redirect("/plataforma");
  return studioId;
}

function finish(studioId: string, error: { message?: string } | null, ok: string): never {
  const state = error
    ? (KNOWN_ERRORS.find((code) => error.message?.includes(code)) ?? "error")
    : ok;
  revalidatePath("/plataforma");
  revalidatePath(`/plataforma/estudios/${studioId}`);
  redirect(`/plataforma/estudios/${studioId}?tab=plan&estado=${state}`);
}

export async function setStudioPlanAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const plan = String(formData.get("plan") ?? "");
  const cutDayRaw = String(formData.get("cut_day") ?? "").trim();
  const cutDay = cutDayRaw === "" ? null : Number(cutDayRaw);
  if (!PLATFORM_PLANS.some((entry) => entry.key === plan))
    finish(studioId, { message: "plan_invalid" }, "");
  if (cutDay !== null && (!Number.isInteger(cutDay) || cutDay < 1 || cutDay > 28)) {
    finish(studioId, { message: "cut_day_invalid" }, "");
  }
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_set_studio_plan", {
    p_studio: studioId,
    p_plan: plan,
    p_cut_day: cutDay,
  });
  finish(studioId, error, "plan_guardado");
}

export async function setStudioModuleAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const moduleKey = String(formData.get("module") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!PLATFORM_MODULES.some((entry) => entry.key === moduleKey)) {
    finish(studioId, { message: "module_invalid" }, "");
  }
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_set_studio_module", {
    p_studio: studioId,
    p_module: moduleKey,
    p_active: active,
  });
  finish(studioId, error, active ? "modulo_activado" : "modulo_desactivado");
}

export async function setStudioStatusAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const status = String(formData.get("status") ?? "");
  if (!STATUSES.includes(status)) finish(studioId, { message: "status_invalid" }, "");
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_set_studio_status", {
    p_studio: studioId,
    p_status: status,
  });
  finish(studioId, error, "estado_guardado");
}

// NEB-01-17 · Modo soporte: entrar con motivo, salir y editar paquetes. Todo queda en bitácora.
const SUPPORT_ERRORS = [
  "forbidden",
  "studio_not_found",
  "support_reason_required",
  "support_session_required",
  "product_not_found",
  "product_name_invalid",
  "product_price_invalid",
];

function finishSupport(
  studioId: string,
  tab: string,
  error: { message?: string } | null,
  ok: string,
): never {
  const state = error
    ? (SUPPORT_ERRORS.find((code) => error.message?.includes(code)) ?? "error")
    : ok;
  revalidatePath(`/plataforma/estudios/${studioId}`);
  redirect(`/plataforma/estudios/${studioId}?tab=${tab}&estado=${state}`);
}

export async function startSupportSessionAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const reason = String(formData.get("reason") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) {
    finishSupport(studioId, "numeros", { message: "support_reason_required" }, "");
  }
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_start_support_session", {
    p_studio: studioId,
    p_reason: reason,
  });
  finishSupport(studioId, "diagnostico", error, "soporte_iniciado");
}

export async function endSupportSessionAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_end_support_session", { p_studio: studioId });
  finishSupport(studioId, "numeros", error, "soporte_terminado");
}

export async function updateSupportPackageAction(formData: FormData) {
  const studioId = studioIdFrom(formData);
  const productId = String(formData.get("product") ?? "");
  if (!UUID.test(productId)) {
    finishSupport(studioId, "paquetes", { message: "product_not_found" }, "");
  }
  const name = String(formData.get("name") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const priceMinor = parsePriceMxnToMinor(String(formData.get("price") ?? ""));
  if (priceMinor === null) {
    finishSupport(studioId, "paquetes", { message: "product_price_invalid" }, "");
  }
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_support_update_package", {
    p_studio: studioId,
    p_product: productId,
    p_name: name,
    p_price_minor: priceMinor,
    p_active: formData.get("active") === "on",
  });
  finishSupport(studioId, "paquetes", error, "paquete_guardado");
}

// NEB-01-19 · Resolver una solicitud de soporte con respuesta para la dueña.
export async function resolveSupportRequestAction(formData: FormData) {
  const requestId = String(formData.get("request") ?? "");
  if (!UUID.test(requestId)) redirect("/plataforma/soporte?estado=support_request_not_found");
  const response = String(formData.get("response") ?? "").trim();
  if (response.length > 2000) redirect("/plataforma/soporte?estado=support_body_too_long");
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_resolve_support_request", {
    p_request: requestId,
    p_response: response,
  });
  revalidatePath("/plataforma/soporte");
  redirect(
    `/plataforma/soporte?estado=${error ? supportRequestErrorCode(error.message) : "resuelta"}`,
  );
}

// NEB-01-20 · Lanzamientos por estudio.
const FEATURE_KEY = /^[a-z][a-z0-9_]{2,40}$/;

function finishFeature(error: { message?: string } | null, ok: string): never {
  const state = error
    ? (["feature_confirm_required", "feature_not_found", "forbidden"].find((code) =>
        error.message?.includes(code),
      ) ?? "error")
    : ok;
  revalidatePath("/plataforma/lanzamientos");
  redirect(`/plataforma/lanzamientos?estado=${state}`);
}

export async function setFeatureStageAction(formData: FormData) {
  const feature = String(formData.get("feature") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!FEATURE_KEY.test(feature) || !["sandbox", "beta", "all"].includes(stage)) {
    finishFeature({ message: "feature_not_found" }, "");
  }
  const supabase = await createClient("admin");
  const { error } = await supabase.rpc("platform_set_feature_stage", {
    p_key: feature,
    p_stage: stage,
    p_confirm_all: formData.get("confirm_all") === "on",
  });
  finishFeature(error, "etapa_guardada");
}

export async function setFeatureBetaStudioAction(formData: FormData) {
  const feature = String(formData.get("feature") ?? "");
  if (!FEATURE_KEY.test(feature)) finishFeature({ message: "feature_not_found" }, "");
  const chosen = new Set(formData.getAll("studios").map(String).filter((id) => UUID.test(id)));
  const supabase = await createClient("admin");
  const { data } = await supabase.rpc("platform_features_list");
  const current = new Set<string>(
    ((data?.features ?? []) as Array<{ key: string; beta_studios?: string[] }>).find(
      (item) => item.key === feature,
    )?.beta_studios ?? [],
  );
  const { data: studios } = await supabase.rpc("platform_list_studios");
  const allIds = ((studios ?? []) as Array<{ id: string }>).map((studio) => studio.id);
  for (const studioId of allIds) {
    const on = chosen.has(studioId);
    if (on === current.has(studioId)) continue;
    const { error } = await supabase.rpc("platform_set_feature_beta_studio", {
      p_key: feature,
      p_studio: studioId,
      p_on: on,
    });
    if (error) finishFeature(error, "");
  }
  finishFeature(null, "beta_guardada");
}
