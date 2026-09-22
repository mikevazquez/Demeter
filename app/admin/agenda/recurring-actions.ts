"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type ScheduleRow = {
  weekday: number;
  time: string;
  instructorId?: string;
  spaceId?: string;
  capacity?: number;
};

function normalizeColorHex(value: FormDataEntryValue | null) {
  const color = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : null;
}

function optionalMoneyToMinor(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, decimals = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export async function createActivity(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const name = String(formData.get("name") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "");
  const durationMinutes = Number(formData.get("duration_minutes"));
  const capacity = Number(formData.get("capacity"));
  const creditCost = Number(formData.get("credit_cost"));
  const dropInPriceMinor = optionalMoneyToMinor(formData.get("drop_in_price"));
  const colorHex = normalizeColorHex(formData.get("color_hex"));
  const requiresResource = String(formData.get("requires_resource") ?? "") === "1";

  if (
    !name ||
    !disciplineId ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    !Number.isInteger(creditCost) ||
    creditCost < 1 ||
    dropInPriceMinor === undefined ||
    !colorHex
  ) {
    redirect("/admin/agenda?error=activity");
  }

  const { error } = await supabase.from("class_templates").insert({
    studio_id: studio.id,
    discipline_id: disciplineId,
    name,
    duration_minutes: durationMinutes,
    capacity,
    credit_cost: creditCost,
    drop_in_price_minor: dropInPriceMinor,
    color_hex: colorHex,
    requires_resource: requiresResource,
  });

  if (error) redirect("/admin/agenda?error=activity");

  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  redirect("/admin/agenda?created=activity");
}

export async function updateActivityColor(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const activityId = String(formData.get("activity_id") ?? "");
  const colorHex = normalizeColorHex(formData.get("color_hex"));
  const requiresResource = String(formData.get("requires_resource") ?? "") === "1";

  if (!activityId || !colorHex) {
    redirect("/admin/agenda?error=color");
  }

  const { data, error } = await supabase
    .from("class_templates")
    .update({ color_hex: colorHex, requires_resource: requiresResource })
    .eq("id", activityId)
    .eq("studio_id", studio.id)
    .select("id")
    .maybeSingle();

  if (error || !data) redirect("/admin/agenda?error=color");

  revalidatePath("/admin/agenda");
  revalidatePath("/student/reservar");
  redirect("/admin/agenda?created=color");
}

export async function createRecurringSchedules(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const templateId = String(formData.get("template_id") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  let rows: ScheduleRow[] = [];

  try {
    rows = JSON.parse(String(formData.get("schedule_rows") ?? "[]"));
  } catch {
    redirect("/admin/agenda?error=schedule");
  }

  if (!templateId || !startsOn || !rows.length) {
    redirect("/admin/agenda?error=schedule");
  }

  const { data: template } = await supabase
    .from("class_templates")
    .select("id,capacity,requires_resource")
    .eq("id", templateId)
    .eq("studio_id", studio.id)
    .eq("active", true)
    .maybeSingle();

  if (!template) redirect("/admin/agenda?error=schedule");

  const inserts = rows.map((row) => ({
    studio_id: studio.id,
    template_id: templateId,
    instructor_id: row.instructorId || null,
    space_id: row.spaceId || null,
    weekday: Number(row.weekday),
    local_time: row.time,
    capacity: Number(row.capacity) > 0 ? Number(row.capacity) : template.capacity,
    notes,
    starts_on: startsOn,
  }));

  for (const row of inserts) {
    if (
      !Number.isInteger(row.weekday) ||
      row.weekday < 0 ||
      row.weekday > 6 ||
      !/^\d{2}:\d{2}$/.test(row.local_time)
    ) {
      redirect("/admin/agenda?error=schedule");
    }

    if (row.instructor_id) {
      const { data } = await supabase
        .from("instructors")
        .select("id")
        .eq("id", row.instructor_id)
        .eq("studio_id", studio.id)
        .eq("status", "active")
        .maybeSingle();

      if (!data) redirect("/admin/agenda?error=instructor");
    }

    if (template.requires_resource && !row.space_id) {
      redirect("/admin/agenda?error=space");
    }

    if (row.space_id) {
      const { data } = await supabase
        .from("spaces")
        .select("id,capacity")
        .eq("id", row.space_id)
        .eq("studio_id", studio.id)
        .eq("active", true)
        .maybeSingle();

      if (!data || (data.capacity && row.capacity > data.capacity)) {
        redirect("/admin/agenda?error=space");
      }
    }
  }

  const { data: schedules, error } = await supabase
    .from("recurring_schedules")
    .insert(inserts)
    .select("id");

  if (error || !schedules) redirect("/admin/agenda?error=schedule");

  for (const schedule of schedules) {
    const { error: materializeError } = await supabase.rpc("materialize_recurring_schedule", {
      p_schedule_id: schedule.id,
      p_through: null,
    });

    if (materializeError) redirect("/admin/agenda?error=conflict");
  }

  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect("/admin/agenda?created=schedule");
}
