"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function zonedDateTimeToUtc(localDateTime: string, timeZone: string) {
  const [datePart, timePart] = localDateTime.split("T"); if (!datePart || !timePart) throw new Error("Invalid datetime");
  const [year, month, day] = datePart.split("-").map(Number); const [hour, minute] = timePart.split(":").map(Number); const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)); return new Date(guess - (asIfUtc - guess));
}

export async function updateSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? ""); const startsLocal = String(formData.get("starts_at") ?? ""); const instructorId = String(formData.get("instructor_id") ?? "") || null; const spaceId = String(formData.get("space_id") ?? "") || null; const capacity = Number(formData.get("capacity")); const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!sessionId || !startsLocal || !Number.isFinite(capacity) || capacity < 1) redirect(`/admin/agenda/${sessionId}?error=edit`);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase.from("class_sessions").select("id, template_id").eq("id", sessionId).eq("studio_id", studio.id).single(); if (!session) redirect("/admin/agenda");
  const { data: template } = await supabase.from("class_templates").select("duration_minutes").eq("id", session.template_id).eq("studio_id", studio.id).single(); if (!template) redirect(`/admin/agenda/${sessionId}?error=edit`);
  const startsAt = zonedDateTimeToUtc(startsLocal, studio.timezone); const endsAt = new Date(startsAt.getTime() + template.duration_minutes * 60_000);
  if (spaceId) { const { data: space } = await supabase.from("spaces").select("id, capacity").eq("id", spaceId).eq("studio_id", studio.id).eq("active", true).maybeSingle(); if (!space || (space.capacity && capacity > space.capacity)) redirect(`/admin/agenda/${sessionId}?error=space`); }
  const { data: conflict } = await supabase.rpc("admin_session_has_conflict", { p_studio_id: studio.id, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(), p_instructor_id: instructorId, p_space_id: spaceId, p_exclude_session_id: sessionId }); if (conflict) redirect(`/admin/agenda/${sessionId}?error=conflict`);
  const { error } = await supabase.from("class_sessions").update({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), instructor_id: instructorId, space_id: spaceId, capacity, notes }).eq("id", sessionId).eq("studio_id", studio.id); if (error) redirect(`/admin/agenda/${sessionId}?error=edit`);
  revalidatePath(`/admin/agenda/${sessionId}`); revalidatePath("/admin/agenda"); revalidatePath("/admin"); redirect(`/admin/agenda/${sessionId}?created=edit`);
}

export async function cancelSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? ""); if (!sessionId) redirect("/admin/agenda");
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.from("class_sessions").update({ status: "cancelled" }).eq("id", sessionId).eq("studio_id", studio.id); if (error) redirect(`/admin/agenda/${sessionId}?error=cancel-session`);
  revalidatePath(`/admin/agenda/${sessionId}`); revalidatePath("/admin/agenda"); revalidatePath("/admin"); redirect(`/admin/agenda/${sessionId}?created=cancel-session`);
}

export async function bookStudent(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? ""); const studentId = String(formData.get("student_id") ?? ""); if (!sessionId || !studentId) redirect(`/admin/agenda/${sessionId}?error=booking`);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE); const { data: session } = await supabase.from("class_sessions").select("id").eq("id", sessionId).eq("studio_id", studio.id).single(); if (!session) redirect("/admin/agenda");
  const { error } = await supabase.rpc("admin_book_student", { target_session_id: sessionId, target_student_id: studentId }); if (error) redirect(`/admin/agenda/${sessionId}?error=${encodeURIComponent(error.message)}`); revalidatePath(`/admin/agenda/${sessionId}`); revalidatePath("/admin"); redirect(`/admin/agenda/${sessionId}?created=booking`);
}

export async function cancelReservation(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? ""); const reservationId = String(formData.get("reservation_id") ?? ""); if (!sessionId || !reservationId) redirect(`/admin/agenda/${sessionId}?error=cancel`);
  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE); const { error } = await supabase.rpc("admin_cancel_reservation", { target_reservation_id: reservationId }); if (error) redirect(`/admin/agenda/${sessionId}?error=cancel`); revalidatePath(`/admin/agenda/${sessionId}`); revalidatePath("/admin"); redirect(`/admin/agenda/${sessionId}?created=cancel`);
}
