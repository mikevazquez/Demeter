"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type AdminSupabaseClient = Awaited<ReturnType<typeof getAdminContext>>["supabase"];

function safeAdminReturn(value: string, fallback: string) {
  if (!value.startsWith("/admin") || value.startsWith("//")) return fallback;
  return value;
}

function withQuery(url: string, key: string, value: string) {
  const [base, hash] = url.split("#", 2);
  const next = `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  return hash ? `${next}#${hash}` : next;
}

function sessionManagementReturn(formData: FormData, sessionId: string) {
  return safeAdminReturn(String(formData.get("return_to") ?? ""), `/admin/agenda/${sessionId}`);
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

async function validateResources(
  supabase: AdminSupabaseClient,
  studioId: string,
  instructorId: string | null,
  spaceId: string | null,
  capacity: number,
) {
  if (instructorId) {
    const { data } = await supabase
      .from("instructors")
      .select("id")
      .eq("id", instructorId)
      .eq("studio_id", studioId)
      .eq("status", "active")
      .maybeSingle();
    if (!data) return "instructor";
  }
  if (spaceId) {
    const { data } = await supabase
      .from("spaces")
      .select("id,capacity")
      .eq("id", spaceId)
      .eq("studio_id", studioId)
      .eq("active", true)
      .maybeSingle();
    if (!data || (data.capacity && capacity > data.capacity)) return "space";
  }
  return null;
}

export async function updateSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  const startsLocal = String(formData.get("starts_at") ?? "");
  const instructorId = String(formData.get("instructor_id") ?? "") || null;
  const spaceId = String(formData.get("space_id") ?? "") || null;
  const capacity = Number(formData.get("capacity"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "single");
  if (!sessionId || !startsLocal || !Number.isFinite(capacity) || capacity < 1)
    redirect(withQuery(returnUrl, "error", "edit"));
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,recurring_schedule_id,status")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session || session.status !== "scheduled") redirect(returnUrl);
  const { data: template } = await supabase
    .from("class_templates")
    .select("duration_minutes")
    .eq("id", session.template_id)
    .eq("studio_id", studio.id)
    .single();
  if (!template) redirect(withQuery(returnUrl, "error", "edit"));
  const resourceError = await validateResources(
    supabase,
    studio.id,
    instructorId,
    spaceId,
    capacity,
  );
  if (resourceError) redirect(withQuery(returnUrl, "error", resourceError));
  const startsAt = zonedDateTimeToUtc(startsLocal, studio.timezone);
  const durationMs = template.duration_minutes * 60_000;
  const endsAt = new Date(startsAt.getTime() + durationMs);
  if (scope === "future" && session.recurring_schedule_id) {
    const { data: future } = await supabase
      .from("class_sessions")
      .select("id,starts_at,status")
      .eq("studio_id", studio.id)
      .eq("recurring_schedule_id", session.recurring_schedule_id)
      .gte("starts_at", session.starts_at)
      .eq("status", "scheduled")
      .order("starts_at");
    const delta = startsAt.getTime() - new Date(session.starts_at).getTime();
    for (const item of future ?? []) {
      const nextStart = new Date(new Date(item.starts_at).getTime() + delta);
      const nextEnd = new Date(nextStart.getTime() + durationMs);
      const { data: conflict } = await supabase.rpc("admin_session_has_conflict", {
        p_studio_id: studio.id,
        p_starts_at: nextStart.toISOString(),
        p_ends_at: nextEnd.toISOString(),
        p_instructor_id: instructorId,
        p_space_id: spaceId,
        p_exclude_session_id: item.id,
      });
      if (conflict) redirect(withQuery(returnUrl, "error", "conflict"));
    }
    for (const item of future ?? []) {
      const nextStart = new Date(new Date(item.starts_at).getTime() + delta);
      await supabase
        .from("class_sessions")
        .update({
          starts_at: nextStart.toISOString(),
          ends_at: new Date(nextStart.getTime() + durationMs).toISOString(),
          instructor_id: instructorId,
          space_id: spaceId,
          capacity,
          notes,
          is_schedule_exception: false,
        })
        .eq("id", item.id)
        .eq("studio_id", studio.id);
    }
    const [datePart, timePart] = startsLocal.split("T");
    const weekday = new Date(`${datePart}T12:00:00Z`).getUTCDay();
    await supabase
      .from("recurring_schedules")
      .update({
        instructor_id: instructorId,
        space_id: spaceId,
        capacity,
        notes,
        weekday,
        local_time: timePart,
        starts_on: datePart,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.recurring_schedule_id)
      .eq("studio_id", studio.id);
  } else {
    const { data: conflict } = await supabase.rpc("admin_session_has_conflict", {
      p_studio_id: studio.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_instructor_id: instructorId,
      p_space_id: spaceId,
      p_exclude_session_id: sessionId,
    });
    if (conflict) redirect(withQuery(returnUrl, "error", "conflict"));
    const { error } = await supabase
      .from("class_sessions")
      .update({
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        instructor_id: instructorId,
        space_id: spaceId,
        capacity,
        notes,
        is_schedule_exception: Boolean(session.recurring_schedule_id),
      })
      .eq("id", sessionId)
      .eq("studio_id", studio.id);
    if (error) redirect(withQuery(returnUrl, "error", "edit"));
  }
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect(withQuery(returnUrl, "created", "edit"));
}

export async function cancelSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  const scope = String(formData.get("scope") ?? "single");
  if (!sessionId) redirect("/admin/agenda");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,starts_at,recurring_schedule_id")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session) redirect(returnUrl);
  if (scope === "future" && session.recurring_schedule_id) {
    await supabase
      .from("class_sessions")
      .update({ status: "cancelled" })
      .eq("studio_id", studio.id)
      .eq("recurring_schedule_id", session.recurring_schedule_id)
      .gte("starts_at", session.starts_at)
      .eq("status", "scheduled");
    await supabase
      .from("recurring_schedules")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", session.recurring_schedule_id)
      .eq("studio_id", studio.id);
  } else
    await supabase
      .from("class_sessions")
      .update({
        status: "cancelled",
        is_schedule_exception: Boolean(session.recurring_schedule_id),
      })
      .eq("id", sessionId)
      .eq("studio_id", studio.id);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect(withQuery(returnUrl, "created", "cancel-session"));
}

export async function bookStudent(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  if (!sessionId || !studentId) redirect(`/admin/agenda/${sessionId}?error=booking`);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session) redirect("/admin/agenda");
  const { error } = await supabase.rpc("admin_book_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });
  if (error) redirect(`/admin/agenda/${sessionId}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?created=booking`);
}
export async function cancelReservation(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  if (!sessionId || !reservationId) redirect(`/admin/agenda/${sessionId}?error=cancel`);
  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_cancel_reservation", {
    target_reservation_id: reservationId,
  });
  if (error) redirect(`/admin/agenda/${sessionId}?error=cancel`);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?created=cancel`);
}
