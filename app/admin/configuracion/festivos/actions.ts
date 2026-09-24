"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const extensionByMime: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function safeYear(value: FormDataEntryValue | null) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2026 && year <= 2042 ? year : new Date().getFullYear();
}

function configPath(year: number, params?: Record<string, string>) {
  const query = new URLSearchParams({ year: String(year), ...(params ?? {}) });
  return `/admin/configuracion/festivos?${query.toString()}`;
}

function safeDate(value: FormDataEntryValue | null) {
  const date = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function zonedDateTimeToUtc(localDateTime: string, timeZone: string) {
  const [datePart, timePart] = localDateTime.split("T");
  if (!datePart || !timePart) throw new Error("Invalid datetime");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (asIfUtc - guess));
}

async function uploadArtwork(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  date: string,
  slot: "hero" | "message",
  file: FormDataEntryValue | null,
) {
  if (!(file instanceof File) || file.size === 0) return null;
  const extension = extensionByMime[file.type];
  if (!extension) throw new Error("image_type");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("image_size");

  const path = `${studioId}/${date}/${slot}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("holiday-artwork").upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error("image_upload");
  return path;
}

async function sessionIdsForDate(ctx: Awaited<ReturnType<typeof getAdminContext>>, date: string) {
  const from = zonedDateTimeToUtc(`${date}T00:00`, ctx.studio.timezone);
  const next = new Date(from.getTime() + 36 * 60 * 60 * 1000);
  const { data } = await ctx.supabase
    .from("class_sessions")
    .select("id,starts_at")
    .eq("studio_id", ctx.studio.id)
    .eq("status", "scheduled")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", next.toISOString());

  const localFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (data ?? [])
    .filter((item) => localFormatter.format(new Date(item.starts_at)) === date)
    .map((item) => item.id);
}

export async function saveCalendarDayAction(formData: FormData) {
  const year = safeYear(formData.get("year"));
  const date = safeDate(formData.get("holiday_date"));
  const sourceKind = String(formData.get("source_kind") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const operationMode = String(formData.get("operation_mode") ?? "");
  const message = String(formData.get("student_message") ?? "").trim();
  const themeKey = String(formData.get("theme_key") ?? "").trim() || null;

  if (
    !date ||
    !["official", "manual"].includes(sourceKind) ||
    !["normal", "closed", "special"].includes(operationMode)
  ) {
    redirect(configPath(year, { error: "invalid" }));
  }

  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const { data: existing } = await ctx.supabase
    .from("studio_holiday_overrides")
    .select("hero_image_path,message_image_path")
    .eq("studio_id", ctx.studio.id)
    .eq("holiday_date", date)
    .maybeSingle();

  let heroPath = existing?.hero_image_path ?? null;
  let messagePath = existing?.message_image_path ?? null;
  let uploadedHero: string | null = null;
  let uploadedMessage: string | null = null;

  try {
    uploadedHero = await uploadArtwork(
      ctx.supabase,
      ctx.studio.id,
      date,
      "hero",
      formData.get("hero_image"),
    );
    uploadedMessage = await uploadArtwork(
      ctx.supabase,
      ctx.studio.id,
      date,
      "message",
      formData.get("message_image"),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "image_upload";
    redirect(configPath(year, { error: code }));
  }

  if (String(formData.get("remove_hero") ?? "") === "1") heroPath = null;
  if (String(formData.get("remove_message") ?? "") === "1") messagePath = null;
  if (uploadedHero) heroPath = uploadedHero;
  if (uploadedMessage) messagePath = uploadedMessage;

  const requestedKeepSessionIds = formData.getAll("keep_session_id").map(String).filter(Boolean);
  const keepSessionIds =
    operationMode === "special"
      ? requestedKeepSessionIds.length
        ? requestedKeepSessionIds
        : await sessionIdsForDate(ctx, date)
      : [];

  const { error } = await ctx.supabase.rpc("admin_save_calendar_day", {
    target_studio_id: ctx.studio.id,
    target_date: date,
    p_source_kind: sourceKind,
    p_name: name || null,
    p_operation_mode: operationMode,
    p_student_message: message || null,
    p_keep_session_ids: keepSessionIds,
    p_theme_key: themeKey,
    p_hero_image_path: heroPath,
    p_message_image_path: messagePath,
  });

  if (error) {
    if (uploadedHero) await ctx.supabase.storage.from("holiday-artwork").remove([uploadedHero]);
    if (uploadedMessage)
      await ctx.supabase.storage.from("holiday-artwork").remove([uploadedMessage]);
    redirect(configPath(year, { error: "save" }));
  }

  const stalePaths = [
    existing?.hero_image_path && existing.hero_image_path !== heroPath
      ? existing.hero_image_path
      : null,
    existing?.message_image_path && existing.message_image_path !== messagePath
      ? existing.message_image_path
      : null,
  ].filter((value): value is string => Boolean(value));

  if (stalePaths.length) await ctx.supabase.storage.from("holiday-artwork").remove(stalePaths);

  revalidatePath("/admin/configuracion/festivos");
  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  redirect(configPath(year, { saved: date }));
}

export async function createManualCalendarDayAction(formData: FormData) {
  const year = safeYear(formData.get("year"));
  const date = safeDate(formData.get("holiday_date"));
  const name = String(formData.get("name") ?? "").trim();
  const operationMode = String(formData.get("operation_mode") ?? "normal");
  const message = String(formData.get("student_message") ?? "").trim();

  if (!date || name.length < 2 || name.length > 100) {
    redirect(configPath(year, { error: "manual" }));
  }

  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const { data: official } = await ctx.supabase
    .from("official_holidays")
    .select("id")
    .eq("country_code", "MX")
    .eq("holiday_date", date)
    .eq("is_official", true)
    .maybeSingle();

  if (official) redirect(configPath(year, { error: "official_collision" }));

  const { error } = await ctx.supabase.rpc("admin_save_calendar_day", {
    target_studio_id: ctx.studio.id,
    target_date: date,
    p_source_kind: "manual",
    p_name: name,
    p_operation_mode: ["normal", "closed", "special"].includes(operationMode)
      ? operationMode
      : "normal",
    p_student_message: message || null,
    p_keep_session_ids: operationMode === "special" ? await sessionIdsForDate(ctx, date) : [],
    p_theme_key: "custom",
    p_hero_image_path: null,
    p_message_image_path: null,
  });

  if (error) redirect(configPath(year, { error: "manual" }));

  revalidatePath("/admin/configuracion/festivos");
  revalidatePath("/admin/agenda");
  redirect(configPath(year, { created: date }));
}

export async function bulkCalendarDayOperationAction(formData: FormData) {
  const year = safeYear(formData.get("year"));
  const mode = String(formData.get("operation_mode") ?? "");
  const rawDates = String(formData.get("selected_dates") ?? "[]");
  let dates: string[] = [];

  try {
    dates = (JSON.parse(rawDates) as unknown[])
      .map(String)
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  } catch {
    redirect(configPath(year, { error: "bulk" }));
  }

  if (!dates.length || !["normal", "closed", "special"].includes(mode)) {
    redirect(configPath(year, { error: "bulk" }));
  }

  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  for (const date of dates) {
    const [{ data: official }, { data: override }] = await Promise.all([
      ctx.supabase
        .from("official_holidays")
        .select("id,name,theme_key,default_message")
        .eq("country_code", "MX")
        .eq("holiday_date", date)
        .eq("is_official", true)
        .maybeSingle(),
      ctx.supabase
        .from("studio_holiday_overrides")
        .select(
          "source_kind,custom_name,theme_key,student_message,hero_image_path,message_image_path",
        )
        .eq("studio_id", ctx.studio.id)
        .eq("holiday_date", date)
        .maybeSingle(),
    ]);

    const sourceKind = override?.source_kind ?? (official ? "official" : null);
    if (!sourceKind) continue;

    const keepSessionIds = mode === "special" ? await sessionIdsForDate(ctx, date) : [];
    const { error } = await ctx.supabase.rpc("admin_save_calendar_day", {
      target_studio_id: ctx.studio.id,
      target_date: date,
      p_source_kind: sourceKind,
      p_name: override?.custom_name ?? official?.name ?? null,
      p_operation_mode: mode,
      p_student_message: override?.student_message ?? official?.default_message ?? null,
      p_keep_session_ids: keepSessionIds,
      p_theme_key: override?.theme_key ?? official?.theme_key ?? null,
      p_hero_image_path: override?.hero_image_path ?? null,
      p_message_image_path: override?.message_image_path ?? null,
    });

    if (error) redirect(configPath(year, { error: "bulk_save" }));
  }

  revalidatePath("/admin/configuracion/festivos");
  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  redirect(configPath(year, { bulk: String(dates.length), mode }));
}

export async function deleteManualCalendarDayAction(formData: FormData) {
  const year = safeYear(formData.get("year"));
  const date = safeDate(formData.get("holiday_date"));
  if (!date) redirect(configPath(year, { error: "invalid" }));

  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const { data: existing } = await ctx.supabase
    .from("studio_holiday_overrides")
    .select("hero_image_path,message_image_path")
    .eq("studio_id", ctx.studio.id)
    .eq("holiday_date", date)
    .eq("source_kind", "manual")
    .maybeSingle();

  const { error } = await ctx.supabase.rpc("admin_delete_manual_calendar_day", {
    target_studio_id: ctx.studio.id,
    target_date: date,
  });
  if (error) redirect(configPath(year, { error: "delete" }));

  const paths = [existing?.hero_image_path, existing?.message_image_path].filter(
    (value): value is string => Boolean(value),
  );
  if (paths.length) await ctx.supabase.storage.from("holiday-artwork").remove(paths);

  revalidatePath("/admin/configuracion/festivos");
  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  redirect(configPath(year, { deleted: date }));
}
