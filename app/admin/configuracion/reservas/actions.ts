"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function moneyToMinor(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function reservationsPath(params?: Record<string, string>) {
  const query = new URLSearchParams(params);
  return query.size
    ? `/admin/configuracion/reservas?${query.toString()}`
    : "/admin/configuracion/reservas";
}

export async function saveReservationPolicyAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const cutoffHours = Number(formData.get("cancellation_cutoff_hours"));
  const latePenalty = moneyToMinor(formData.get("unlimited_late_cancellation_penalty"));
  const noShowPenalty = moneyToMinor(formData.get("unlimited_no_show_penalty"));

  if (!Number.isFinite(cutoffHours) || cutoffHours < 0 || cutoffHours > 168) {
    redirect(reservationsPath({ error: "cutoff" }));
  }

  if (latePenalty == null || noShowPenalty == null) {
    redirect(reservationsPath({ error: "penalty" }));
  }

  const { data: current, error: currentError } = await ctx.supabase
    .from("studio_operating_policies")
    .select(
      "default_minimum_reservations_enabled,default_minimum_reservations,default_minimum_review_minutes_before,default_minimum_override_allowed",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (currentError) {
    redirect(reservationsPath({ error: "save" }));
  }

  const { error } = await ctx.supabase.rpc("owner_update_studio_operating_policy_v2", {
    p_studio_id: ctx.studio.id,
    p_cancellation_cutoff_minutes: Math.round(cutoffHours * 60),
    p_late_cancellation_consumes_credit: checkboxValue(
      formData,
      "late_cancellation_consumes_credit",
    ),
    p_no_show_consumes_credit: checkboxValue(formData, "no_show_consumes_credit"),
    p_default_minimum_reservations_enabled: current?.default_minimum_reservations_enabled ?? false,
    p_default_minimum_reservations: current?.default_minimum_reservations ?? 2,
    p_default_minimum_review_minutes_before: current?.default_minimum_review_minutes_before ?? 120,
    p_default_minimum_override_allowed: current?.default_minimum_override_allowed ?? true,
    p_unlimited_late_cancellation_penalty_minor: latePenalty,
    p_unlimited_no_show_penalty_minor: noShowPenalty,
  });

  if (error) {
    console.error("[studio.reservations] Reservation policy update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(reservationsPath({ error: "save" }));
  }

  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/reservas");
  redirect(reservationsPath({ saved: "1" }));
}
