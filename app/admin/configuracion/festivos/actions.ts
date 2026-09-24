"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function safeYear(value: FormDataEntryValue | null) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2026 && year <= 2042 ? year : new Date().getFullYear();
}

function safeDate(value: FormDataEntryValue | null) {
  const date = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function configPath(year: number, params?: Record<string, string>) {
  const query = new URLSearchParams({ year: String(year), ...(params ?? {}) });
  return `/admin/configuracion/festivos?${query.toString()}`;
}

export async function saveOfficialHolidayStatusAction(formData: FormData) {
  const year = safeYear(formData.get("year"));
  const date = safeDate(formData.get("holiday_date"));
  const closed = String(formData.get("closed") ?? "") === "1";

  if (!date) {
    redirect(configPath(year, { error: "invalid" }));
  }

  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: holiday, error: holidayError } = await ctx.supabase
    .from("official_holidays")
    .select("id,holiday_date")
    .eq("country_code", "MX")
    .eq("holiday_date", date)
    .eq("is_official", true)
    .maybeSingle();

  if (holidayError || !holiday) {
    redirect(configPath(year, { error: "not_found" }));
  }

  const { error } = await ctx.supabase.rpc("admin_configure_holiday", {
    target_studio_id: ctx.studio.id,
    target_date: date,
    p_operation_mode: closed ? "closed" : "normal",
    p_student_message: null,
    p_keep_session_ids: [],
  });

  if (error) {
    console.error("[festivos.simple] save failed", {
      studioId: ctx.studio.id,
      date,
      closed,
      error: error.message,
    });
    redirect(configPath(year, { error: "save" }));
  }

  revalidatePath("/admin/configuracion/festivos");
  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");

  redirect(configPath(year, { saved: date }));
}
