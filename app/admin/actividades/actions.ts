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

async function preserveBookedAndClearGeneratedSessions(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  scheduleId: string,
) {
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("studio_id", studioId)
    .eq("recurring_schedule_id", scheduleId)
    .gte("starts_at", new Date().toISOString());

  const ids = (sessions ?? []).map((session) => session.id);
  if (!ids.length) return;

  const { data: reservations } = await supabase
    .from("reservations")
    .select("session_id")
    .in("session_id", ids);

  const reservedIds = new Set((reservations ?? []).map((reservation) => reservation.session_id));
  const preserved = ids.filter((id) => reservedIds.has(id));
  const disposable = ids.filter((id) => !reservedIds.has(id));

  if (preserved.length) {
    const { error } = await supabase
      .from("class_sessions")
      .update({ recurring_schedule_id: null, is_schedule_exception: true })
      .in("id", preserved)
      .eq("studio_id", studioId);
    if (error) throw error;
  }

  if (disposable.length) {
    const { error } = await supabase
      .from("class_sessions")
      .delete()
      .in("id", disposable)
      .eq("studio_id", studioId);
    if (error) throw error;
  }

}

export async function saveActivity(formData: FormData) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  let payload: ActivityPayload;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    redirect("/admin/actividades/nueva?error=invalid");
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
    (payload.allowIndividualPurchase && (dropInPriceMinor == null || dropInPriceMinor <= 0))
  ) {
    redirect(
      payload.activityId
        ? `/admin/actividades/${payload.activityId}?error=invalid`
        : "/admin/actividades/nueva?error=invalid",
    );
  }

  const normalizedSchedules = schedules.map((row) => {
    const weekday = Number(row.weekday);
    const localTime = String(row.startTime ?? "");

    if (
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      !/^\d{2}:\d{2}$/.test(localTime)
    ) {
      throw new Error("invalid_schedule");
    }

    return {
      id: row.id || null,
      weekday,
      local_time: localTime,
      duration_minutes: durationMinutes,
      instructor_id: defaultInstructorId,
      space_id: defaultSpaceId,
      starts_on: startsOn,
      ends_on: endsOn,
    };
  });

  let savedActivityId = payload.activityId || "";

  try {
    const instructorIds = [
      ...new Set(normalizedSchedules.map((row) => row.instructor_id).filter(Boolean)),
    ] as string[];
    const spaceIds = [
      ...new Set(normalizedSchedules.map((row) => row.space_id).filter(Boolean)),
    ] as string[];

    if (instructorIds.length) {
      const { data } = await supabase
        .from("instructors")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("status", "active")
        .in("id", instructorIds);
      if ((data ?? []).length !== instructorIds.length) throw new Error("invalid_instructor");
    }

    if (spaceIds.length) {
      const { data } = await supabase
        .from("spaces")
        .select("id,capacity")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .in("id", spaceIds);
      if ((data ?? []).length !== spaceIds.length) throw new Error("invalid_space");
      if ((data ?? []).some((space) => space.capacity && capacity > space.capacity)) {
        throw new Error("space_capacity");
      }
    }

    let activityId = payload.activityId || "";

    if (activityId) {
      const { data: existing, error: existingError } = await supabase
        .from("class_templates")
        .select("id,color_hex")
        .eq("id", activityId)
        .eq("studio_id", studio.id)
        .maybeSingle();

      if (existingError || !existing) throw new Error("activity_not_found");

      const { error: updateError } = await supabase
        .from("class_templates")
        .update({
          name,
          description,
          duration_minutes: durationMinutes,
          capacity,
          color_hex: colorHex,
          requires_resource: Boolean(payload.requiresResource),
          credit_cost: 1,
          drop_in_price_minor: dropInPriceMinor,
          individual_purchase_notes: payload.allowIndividualPurchase ? notes : null,
        })
        .eq("id", activityId)
        .eq("studio_id", studio.id);

      if (updateError) throw updateError;

      const { data: currentSchedules, error: currentSchedulesError } = await supabase
        .from("recurring_schedules")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("template_id", activityId);

      if (currentSchedulesError) throw currentSchedulesError;

      const incomingIds = new Set(
        normalizedSchedules.map((row) => row.id).filter(Boolean) as string[],
      );

      for (const existingSchedule of currentSchedules ?? []) {
        if (!incomingIds.has(existingSchedule.id)) {
          await preserveBookedAndClearGeneratedSessions(supabase, studio.id, existingSchedule.id);
          const { error } = await supabase
            .from("recurring_schedules")
            .update({ active: false })
            .eq("id", existingSchedule.id)
            .eq("studio_id", studio.id);
          if (error) throw error;
        }
      }

      for (const row of normalizedSchedules) {
        if (row.id) {
          await preserveBookedAndClearGeneratedSessions(supabase, studio.id, row.id);
          const { error } = await supabase
            .from("recurring_schedules")
            .update({
              instructor_id: row.instructor_id,
              space_id: row.space_id,
              weekday: row.weekday,
              local_time: row.local_time,
              duration_minutes: row.duration_minutes,
              capacity,
              starts_on: row.starts_on,
              ends_on: row.ends_on,
              active: true,
            })
            .eq("id", row.id)
            .eq("template_id", activityId)
            .eq("studio_id", studio.id);
          if (error) throw error;
        } else {
          const { data: inserted, error } = await supabase
            .from("recurring_schedules")
            .insert({
              studio_id: studio.id,
              template_id: activityId,
              instructor_id: row.instructor_id,
              space_id: row.space_id,
              weekday: row.weekday,
              local_time: row.local_time,
              duration_minutes: row.duration_minutes,
              capacity,
              starts_on: row.starts_on,
              ends_on: row.ends_on,
              active: true,
            })
            .select("id")
            .single();
          if (error || !inserted) throw error ?? new Error("schedule_insert_failed");
          row.id = inserted.id;
        }
      }
    } else {
      const { data: created, error: createError } = await supabase
        .from("class_templates")
        .insert({
          studio_id: studio.id,
          discipline_id: null,
          name,
          description,
          duration_minutes: durationMinutes,
          capacity,
          active: true,
          credit_cost: 1,
          drop_in_price_minor: dropInPriceMinor,
          individual_purchase_notes: payload.allowIndividualPurchase ? notes : null,
          color_hex: colorHex,
          requires_resource: Boolean(payload.requiresResource),
        })
        .select("id")
        .single();

      if (createError || !created) throw createError ?? new Error("activity_insert_failed");
      activityId = created.id;

      const { data: insertedSchedules, error: scheduleError } = await supabase
        .from("recurring_schedules")
        .insert(
          normalizedSchedules.map((row) => ({
            studio_id: studio.id,
            template_id: activityId,
            instructor_id: row.instructor_id,
            space_id: row.space_id,
            weekday: row.weekday,
            local_time: row.local_time,
            duration_minutes: row.duration_minutes,
            capacity,
            starts_on: row.starts_on,
            ends_on: row.ends_on,
            active: true,
          })),
        )
        .select("id");

      if (scheduleError || !insertedSchedules) {
        await supabase
          .from("class_templates")
          .delete()
          .eq("id", activityId)
          .eq("studio_id", studio.id);
        throw scheduleError ?? new Error("schedule_insert_failed");
      }

      insertedSchedules.forEach((item, index) => {
        normalizedSchedules[index].id = item.id;
      });
    }

    for (const row of normalizedSchedules) {
      if (!row.id) continue;
      const { error } = await supabase.rpc("materialize_recurring_schedule", {
        p_schedule_id: row.id,
        p_through: null,
      });
      if (error) throw error;
    }

    savedActivityId = activityId;
    revalidatePath("/admin/actividades");
    revalidatePath("/admin/agenda");
    revalidatePath("/admin");
    revalidatePath("/student/reservar");
  } catch {
    redirect(
      payload.activityId
        ? `/admin/actividades/${payload.activityId}?error=save`
        : "/admin/actividades/nueva?error=save",
    );
  }

  redirect(`/admin/actividades/${savedActivityId}`);
}
