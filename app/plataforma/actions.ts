"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PLATFORM_MODULES, PLATFORM_PLANS } from "@/lib/platform/catalog";
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
  if (!PLATFORM_PLANS.some((entry) => entry.key === plan)) finish(studioId, { message: "plan_invalid" }, "");
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
