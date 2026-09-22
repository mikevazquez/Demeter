"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

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

function addLocalWeeks(localDateTime: string, weeks: number) {
  const [datePart, timePart] = localDateTime.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + weeks * 7));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${timePart}`;
}

async function validateResources(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
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
      .select("id, capacity")
      .eq("id", spaceId)
      .eq("studio_id", studioId)
      .eq("active", true)
      .maybeSingle();
    if (!data || (data.capacity && capacity > data.capacity)) return "space";
  }
  return null;
}

export async function createDiscipline(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/agenda?error=discipline");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.from("disciplines").insert({ studio_id: studio.id, name });
  if (error) redirect("/admin/agenda?error=discipline");
  revalidatePath("/admin/agenda");
  redirect("/admin/agenda?created=discipline");
}

export async function createTemplate(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "");
  const durationMinutes = Number(formData.get("duration_minutes"));
  const capacity = Number(formData.get("capacity"));
  const requiresResource = String(formData.get("requires_resource") ?? "") === "1";
  if (!name || !disciplineId || !Number.isFinite(durationMinutes) || !Number.isFinite(capacity))
    redirect("/admin/agenda?error=template");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.from("class_templates").insert({
    studio_id: studio.id,
    discipline_id: disciplineId,
    name,
    duration_minutes: durationMinutes,
    capacity,
    requires_resource: requiresResource,
  });
  if (error) redirect("/admin/agenda?error=template");
  revalidatePath("/admin/agenda");
  redirect("/admin/agenda?created=template");
}

export async function createSession(formData: FormData) {
  const templateId = String(formData.get("template_id") ?? "");
  const instructorId = String(formData.get("instructor_id") ?? "") || null;
  const spaceId = String(formData.get("space_id") ?? "") || null;
  const startsLocal = String(formData.get("starts_at") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const capacityOverride = Number(formData.get("capacity"));
  const repeatWeeks = Math.min(Math.max(Number(formData.get("repeat_weeks")) || 1, 1), 12);
  if (!templateId || !startsLocal) redirect("/admin/agenda?error=session");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: template } = await supabase
    .from("class_templates")
    .select("id, duration_minutes, capacity, requires_resource")
    .eq("id", templateId)
    .eq("studio_id", studio.id)
    .single();
  if (!template) redirect("/admin/agenda?error=session");
  const capacity =
    Number.isFinite(capacityOverride) && capacityOverride > 0
      ? capacityOverride
      : template.capacity;
  if (template.requires_resource && !spaceId) {
    redirect("/admin/agenda?error=space");
  }

  const resourceError = await validateResources(
    supabase,
    studio.id,
    instructorId,
    spaceId,
    capacity,
  );
  if (resourceError) redirect(`/admin/agenda?error=${resourceError}`);
  const rows = [];
  for (let index = 0; index < repeatWeeks; index += 1) {
    const startsAt = zonedDateTimeToUtc(addLocalWeeks(startsLocal, index), studio.timezone);
    const endsAt = new Date(startsAt.getTime() + template.duration_minutes * 60_000);
    const { data: conflict } = await supabase.rpc("admin_session_has_conflict", {
      p_studio_id: studio.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_instructor_id: instructorId,
      p_space_id: spaceId,
      p_exclude_session_id: null,
    });
    if (conflict) redirect("/admin/agenda?error=conflict");
    rows.push({
      studio_id: studio.id,
      template_id: templateId,
      instructor_id: instructorId,
      space_id: spaceId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity,
      notes,
      requires_resource: template.requires_resource,
      resource_uses_per_item: 1,
    });
  }
  const { error } = await supabase.from("class_sessions").insert(rows);
  if (error) redirect("/admin/agenda?error=session");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  if (instructorId) revalidatePath(`/admin/instructores/${instructorId}`);
  redirect(`/admin/agenda?created=${repeatWeeks > 1 ? "series" : "session"}`);
}

export async function updateSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const instructorId = String(formData.get("instructor_id") ?? "") || null;
  const spaceId = String(formData.get("space_id") ?? "") || null;
  const startsLocal = String(formData.get("starts_at") ?? "");
  const capacity = Number(formData.get("capacity"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!sessionId || !startsLocal || !Number.isFinite(capacity) || capacity < 1)
    redirect(`/admin/agenda/${sessionId}?error=invalid`);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, template_id, status")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!session || session.status !== "scheduled") redirect("/admin/agenda?error=session");
  const { data: template } = await supabase
    .from("class_templates")
    .select("duration_minutes")
    .eq("id", session.template_id)
    .eq("studio_id", studio.id)
    .single();
  if (!template) redirect(`/admin/agenda/${sessionId}?error=invalid`);
  const resourceError = await validateResources(
    supabase,
    studio.id,
    instructorId,
    spaceId,
    capacity,
  );
  if (resourceError) redirect(`/admin/agenda/${sessionId}?error=${resourceError}`);
  const startsAt = zonedDateTimeToUtc(startsLocal, studio.timezone);
  const endsAt = new Date(startsAt.getTime() + template.duration_minutes * 60_000);
  const { data: conflict } = await supabase.rpc("admin_session_has_conflict", {
    p_studio_id: studio.id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_instructor_id: instructorId,
    p_space_id: spaceId,
    p_exclude_session_id: sessionId,
  });
  if (conflict) redirect(`/admin/agenda/${sessionId}?error=conflict`);
  const { error } = await supabase
    .from("class_sessions")
    .update({
      instructor_id: instructorId,
      space_id: spaceId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity,
      notes,
    })
    .eq("id", sessionId)
    .eq("studio_id", studio.id);
  if (error) redirect(`/admin/agenda/${sessionId}?error=save`);
  revalidatePath("/admin/agenda");
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?saved=1`);
}

export async function cancelSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) redirect("/admin/agenda");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase
    .from("class_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .eq("status", "scheduled");
  if (error) redirect(`/admin/agenda/${sessionId}?error=cancel`);
  revalidatePath("/admin/agenda");
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?saved=cancelled`);
}
