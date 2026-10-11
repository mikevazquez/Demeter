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
  if (!ctx.can(CAPABILITIES.SETTINGS_WRITE)) {
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

export async function createCalendarEventAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const starts = String(formData.get("starts_on") ?? "");
  const year = Number(starts.slice(0, 4));
  const { data, error } = await ctx.supabase.rpc("admin_create_calendar_event", {
    p_studio_id: ctx.studio.id,
    p_name: String(formData.get("name") ?? "").trim(),
    p_starts_on: starts,
    p_duration: Number(formData.get("duration")),
    p_icon: String(formData.get("icon") ?? "🎉"),
  });
  if (error) redirect(configPath(year, { error: error.message }));
  revalidatePath("/admin/configuracion/festivos");
  redirect(configPath(year, { event: String(data) }));
}

export async function saveCalendarEventAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const year = safeYear(formData.get("year"));
  const eventId = String(formData.get("event_id") ?? "");
  const { data: event, error: readError } = await ctx.supabase
    .from("calendar_events")
    .select("id,days,studio_id")
    .eq("id", eventId)
    .maybeSingle();
  if (readError || !event || (event.studio_id && event.studio_id !== ctx.studio.id))
    redirect(configPath(year, { error: "event_not_found" }));
  const days = (event.days as { date: string }[]).map((day) => ({
    date: day.date,
    mode: String(formData.get(`mode_${day.date}`) ?? "normal"),
    keep: formData.getAll(`keep_${day.date}`).map(String),
  }));
  const { error } = await ctx.supabase.rpc("admin_configure_calendar_event", {
    p_studio_id: ctx.studio.id,
    p_event_id: eventId,
    p_days: days,
    p_message: String(formData.get("message") ?? "").trim(),
  });
  if (error) redirect(configPath(year, { event: eventId, error: error.message }));
  for (const path of [
    "/admin/configuracion/festivos",
    "/admin/agenda",
    "/admin",
    "/student/reservar",
    "/student/mis-clases",
  ])
    revalidatePath(path);
  redirect(configPath(year, { saved: "decision" }));
}
