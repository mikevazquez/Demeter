"use server";

import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { PLATFORM_MODULES } from "@/lib/platform/catalog";

const KNOWN_ERRORS = ["module_already_active", "forbidden", "module_invalid"];

// NEB-01-03 · El estudio pide activar un módulo. El cobro con Stripe llega en NEB-01-34.
export async function requestModuleActivationAction(formData: FormData) {
  const moduleKey = String(formData.get("module") ?? "");
  if (!PLATFORM_MODULES.some((entry) => entry.key === moduleKey)) {
    redirect("/admin/mas");
  }
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await ctx.supabase.rpc("studio_request_module", {
    p_studio: ctx.studio.id,
    p_module: moduleKey,
  });
  const state = error
    ? (KNOWN_ERRORS.find((code) => error.message?.includes(code)) ?? "error")
    : "solicitado";
  redirect(`/admin/modulos/${moduleKey}?estado=${state}`);
}
