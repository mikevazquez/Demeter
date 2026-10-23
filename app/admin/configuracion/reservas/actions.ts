"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { parseBookingWindowForm } from "@/lib/booking-windows";

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

// NEB-01-39/40 · Apertura y cierre de reservas y ventana del registro con QR del estudio.
export async function saveBookingWindowsAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }
  const parsed = parseBookingWindowForm(formData, "studio");
  if (!parsed.ok) redirect(reservationsPath({ error: `window_${parsed.error}` }));
  const values = parsed.values;

  const { error } = await ctx.supabase.rpc("owner_update_studio_booking_windows", {
    p_studio_id: ctx.studio.id,
    p_booking_close_minutes_before: values.bookingCloseMinutesBefore,
    p_booking_open_mode: values.bookingOpenMode ?? "none",
    p_booking_open_minutes_before: values.bookingOpenMinutesBefore,
    p_booking_open_weekday: values.bookingOpenWeekday,
    p_booking_open_time: values.bookingOpenTime,
    p_checkin_opens_minutes_before: values.checkinOpensMinutesBefore,
    p_checkin_closes_minutes_after: values.checkinClosesMinutesAfter,
  });

  if (error) {
    console.error("[studio.reservations] Booking windows update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(reservationsPath({ error: "save" }));
  }

  revalidatePath("/admin/configuracion/reservas");
  redirect(reservationsPath({ saved: "windows" }));
}

// NEB-01-41 · Penalizaciones para alumnas regulares (pausa de reservas y cargo en paquetes).
export async function savePenaltyPolicyAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const lateCharge = moneyToMinor(formData.get("package_late_cancellation_penalty")) ?? 0;
  const noShowCharge = moneyToMinor(formData.get("package_no_show_penalty")) ?? 0;
  const pause = (prefix: "no_show" | "late_cancel") => {
    if (!checkboxValue(formData, `${prefix}_block_enabled`)) {
      return { threshold: null, windowDays: null, blockDays: null };
    }
    const threshold = Number(formData.get(`${prefix}_block_threshold`));
    const windowDays = Number(formData.get(`${prefix}_block_window_days`));
    const blockDays = Number(formData.get(`${prefix}_block_days`));
    const valid =
      Number.isInteger(threshold) &&
      threshold >= 1 &&
      threshold <= 20 &&
      Number.isInteger(windowDays) &&
      windowDays >= 1 &&
      windowDays <= 365 &&
      Number.isInteger(blockDays) &&
      blockDays >= 1 &&
      blockDays <= 90;
    return valid ? { threshold, windowDays, blockDays } : null;
  };
  const noShow = pause("no_show");
  const lateCancel = pause("late_cancel");
  if (!noShow || !lateCancel) redirect(reservationsPath({ error: "pause" }));
  if (lateCharge > 10_000_000 || noShowCharge > 10_000_000) {
    redirect(reservationsPath({ error: "penalty" }));
  }

  const { error } = await ctx.supabase.rpc("owner_update_studio_penalty_policy", {
    p_studio_id: ctx.studio.id,
    p_package_late_cancellation_penalty_minor: lateCharge,
    p_package_no_show_penalty_minor: noShowCharge,
    p_pending_charge_blocks_booking: checkboxValue(formData, "pending_charge_blocks_booking"),
    p_no_show_block_threshold: noShow.threshold,
    p_no_show_block_window_days: noShow.windowDays,
    p_no_show_block_days: noShow.blockDays,
    p_late_cancel_block_threshold: lateCancel.threshold,
    p_late_cancel_block_window_days: lateCancel.windowDays,
    p_late_cancel_block_days: lateCancel.blockDays,
  });

  if (error) {
    console.error("[studio.reservations] Penalty policy update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(reservationsPath({ error: "save" }));
  }

  revalidatePath("/admin/configuracion/reservas");
  redirect(reservationsPath({ saved: "penalties" }));
}
