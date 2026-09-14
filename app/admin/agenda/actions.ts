"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/admin/agenda?error=access");
  }

  return { supabase, user, studioId: membership.studio_id };
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

  const offset = asIfUtc - guess;
  return new Date(guess - offset);
}

export async function createDiscipline(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/agenda?error=discipline");

  const { supabase, studioId } = await requireAdmin();
  const { error } = await supabase.from("disciplines").insert({ studio_id: studioId, name });

  if (error) redirect("/admin/agenda?error=discipline");
  revalidatePath("/admin/agenda");
  redirect("/admin/agenda?created=discipline");
}

export async function createTemplate(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "");
  const durationMinutes = Number(formData.get("duration_minutes"));
  const capacity = Number(formData.get("capacity"));

  if (!name || !disciplineId || !Number.isFinite(durationMinutes) || !Number.isFinite(capacity)) {
    redirect("/admin/agenda?error=template");
  }

  const { supabase, studioId } = await requireAdmin();
  const { error } = await supabase.from("class_templates").insert({
    studio_id: studioId,
    discipline_id: disciplineId,
    name,
    duration_minutes: durationMinutes,
    capacity,
  });

  if (error) redirect("/admin/agenda?error=template");
  revalidatePath("/admin/agenda");
  redirect("/admin/agenda?created=template");
}

export async function createSession(formData: FormData) {
  const templateId = String(formData.get("template_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "") || null;
  const startsLocal = String(formData.get("starts_at") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!templateId || !startsLocal) redirect("/admin/agenda?error=session");

  const { supabase, studioId, user } = await requireAdmin();

  const [{ data: studio }, { data: template }] = await Promise.all([
    supabase.from("studios").select("timezone").eq("id", studioId).single(),
    supabase
      .from("class_templates")
      .select("id, duration_minutes, capacity")
      .eq("id", templateId)
      .eq("studio_id", studioId)
      .single(),
  ]);

  if (!studio || !template) redirect("/admin/agenda?error=session");

  const startsAt = zonedDateTimeToUtc(startsLocal, studio.timezone);
  const endsAt = new Date(startsAt.getTime() + template.duration_minutes * 60_000);

  const { error } = await supabase.from("class_sessions").insert({
    studio_id: studioId,
    template_id: templateId,
    coach_user_id: user.id,
    location_id: locationId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    capacity: template.capacity,
    notes,
  });

  if (error) redirect("/admin/agenda?error=session");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect("/admin/agenda?created=session");
}
