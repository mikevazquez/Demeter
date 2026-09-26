"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type SchedulePayload = {
  id?: string;
  weekday: number;
  startTime: string;
};

type ActivityPayload = {
  activityId?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  capacity: number;
  colorHex: string;
  requiresResource: boolean;
  defaultInstructorId?: string;
  defaultSpaceId?: string;
  startsOn: string;
  endsOn?: string;
  schedules: SchedulePayload[];
  allowIndividualPurchase: boolean;
  individualPrice?: string;
  individualPurchaseNotes?: string;
  minimumReservationsEnabled: boolean;
  minimumReservations: number;
  minimumReviewValue: number;
  minimumReviewUnit: "minutes" | "hours";
  allowMinimumReservationOverride: boolean;
};

function moneyToMinor(value: string | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, decimals = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function routeForError(payload: ActivityPayload | undefined, code: string) {
  const safeCode = encodeURIComponent(code);
  return payload?.activityId
    ? `/admin/actividades/${payload.activityId}?error=${safeCode}`
    : `/admin/actividades/nueva?error=${safeCode}`;
}

function normalizeRpcError(message: string | undefined) {
  const candidates = [
    "unauthenticated",
    "forbidden",
    "invalid_activity",
    "resource_activity_requires_space",
    "invalid_instructor",
    "invalid_space",
    "space_capacity",
    "invalid_schedule",
    "duplicate_schedule",
    "activity_not_found",
    "schedule_not_found",
    "invalid_minimum_reservation_rule",
  ];

  return candidates.find((code) => message?.includes(code)) ?? "save";
}

export async function saveActivity(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  let payload: ActivityPayload | undefined;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "")) as ActivityPayload;
  } catch {
    redirect("/admin/actividades/nueva?error=invalid_activity");
  }

  const name = String(payload.name ?? "").trim();
  const description = String(payload.description ?? "").trim() || null;
  const durationMinutes = Number(payload.durationMinutes);
  const capacity = Number(payload.capacity);
  const colorHex = String(payload.colorHex ?? "")
    .trim()
    .toUpperCase();
  const schedules = Array.isArray(payload.schedules) ? payload.schedules : [];
  const defaultInstructorId = String(payload.defaultInstructorId ?? "").trim() || null;
  const defaultSpaceId = String(payload.defaultSpaceId ?? "").trim() || null;
  const startsOn = String(payload.startsOn ?? "").trim();
  const endsOn = String(payload.endsOn ?? "").trim() || null;
  const notes = String(payload.individualPurchaseNotes ?? "").trim() || null;
  const dropInPriceMinor = payload.allowIndividualPurchase
    ? moneyToMinor(payload.individualPrice)
    : null;
  const minimumReservations = Number(payload.minimumReservations);
  const minimumReviewValue = Number(payload.minimumReviewValue);
  const minimumReviewMinutes =
    payload.minimumReviewUnit === "hours" ? minimumReviewValue * 60 : minimumReviewValue;

  if (
    !name ||
    name.length > 80 ||
    (description?.length ?? 0) > 500 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 360 ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    !/^#[0-9A-F]{6}$/.test(colorHex) ||
    !schedules.length ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) ||
    (endsOn && (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn)) ||
    (payload.requiresResource && !defaultSpaceId) ||
    (notes?.length ?? 0) > 300 ||
    dropInPriceMinor === undefined ||
    (payload.allowIndividualPurchase && (dropInPriceMinor == null || dropInPriceMinor <= 0)) ||
    (payload.minimumReservationsEnabled &&
      (!Number.isInteger(minimumReservations) ||
        minimumReservations < 1 ||
        minimumReservations > capacity ||
        !Number.isInteger(minimumReviewValue) ||
        minimumReviewValue < 1 ||
        minimumReviewMinutes < 15 ||
        minimumReviewMinutes > 10080))
  ) {
    redirect(routeForError(payload, "invalid_activity"));
  }

  const normalizedSchedules = schedules.map((row) => ({
    id: row.id || null,
    weekday: Number(row.weekday),
    startTime: String(row.startTime ?? ""),
  }));

  if (
    normalizedSchedules.some(
      (row) =>
        !Number.isInteger(row.weekday) ||
        row.weekday < 0 ||
        row.weekday > 6 ||
        !/^\d{2}:\d{2}$/.test(row.startTime),
    )
  ) {
    redirect(routeForError(payload, "invalid_schedule"));
  }

  const { data, error } = await supabase.rpc("admin_save_activity", {
    p_studio_id: studio.id,
    p_activity_id: payload.activityId || null,
    p_name: name,
    p_description: description,
    p_duration_minutes: durationMinutes,
    p_capacity: capacity,
    p_color_hex: colorHex,
    p_requires_resource: Boolean(payload.requiresResource),
    p_drop_in_price_minor: dropInPriceMinor,
    p_individual_purchase_notes: payload.allowIndividualPurchase ? notes : null,
    p_default_instructor_id: defaultInstructorId,
    p_default_space_id: defaultSpaceId,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_schedules: normalizedSchedules,
    p_minimum_reservations_enabled: Boolean(payload.minimumReservationsEnabled),
    p_minimum_reservations: Number.isInteger(minimumReservations) ? minimumReservations : 2,
    p_minimum_review_minutes_before:
      Number.isInteger(minimumReviewMinutes) && minimumReviewMinutes >= 15
        ? minimumReviewMinutes
        : 120,
    p_allow_minimum_reservation_override: Boolean(
      payload.allowMinimumReservationOverride,
    ),
  });

  if (error || !data) {
    redirect(routeForError(payload, normalizeRpcError(error?.message)));
  }

  revalidatePath("/admin/actividades");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  revalidatePath("/student/reservar");

  redirect("/admin/actividades");
}
