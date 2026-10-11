"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

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

export async function setMinimumOverride(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (!sessionId) redirect("/admin/agenda");

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_set_session_minimum_override", {
    target_session_id: sessionId,
    p_enabled: enabled,
  });

  if (error) {
    const message = String(error.message ?? "");
    const code = [
      "minimum_review_already_completed",
      "minimum_rule_disabled",
      "minimum_override_not_allowed",
      "session_not_scheduled",
      "forbidden",
    ].find((item) => message.includes(item));

    redirect(withQuery(returnUrl, "error", code ?? "minimum_override"));
  }

  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect(withQuery(returnUrl, "created", "minimum-override"));
}

export async function updateSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("starts_at,ends_at,credit_cost,drop_in_price_minor")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!session) redirect(withQuery(returnUrl, "error", "session_not_found"));
  const startsLocal = String(formData.get("starts_at") ?? "");
  const duration = formData.has("duration_minutes")
    ? Number(formData.get("duration_minutes"))
    : Math.round(
        (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000,
      );
  const credit = formData.has("credit_cost")
    ? Number(formData.get("credit_cost")) || null
    : session.credit_cost;
  const price = formData.has("drop_in_price")
    ? String(formData.get("drop_in_price") ?? "").trim()
    : null;
  const priceMinor =
    price === null
      ? session.drop_in_price_minor
      : price === ""
        ? null
        : Math.round(Number(price) * 100);
  if (
    !startsLocal ||
    !Number.isFinite(duration) ||
    (priceMinor !== null && !Number.isFinite(priceMinor))
  )
    redirect(withQuery(returnUrl, "error", "edit"));
  const { error } = await supabase.rpc("admin_update_session", {
    p_session_id: sessionId,
    p_starts_at: zonedDateTimeToUtc(startsLocal, studio.timezone).toISOString(),
    p_duration_minutes: duration,
    p_capacity: Number(formData.get("capacity")),
    p_instructor_id: String(formData.get("instructor_id") ?? "") || null,
    p_space_id: String(formData.get("space_id") ?? "") || null,
    p_notes: String(formData.get("notes") ?? ""),
    p_credit_cost: credit,
    p_drop_in_price_minor: priceMinor,
    p_scope: String(formData.get("scope") ?? "single"),
  });
  if (error) redirect(withQuery(returnUrl, "error", error.message));
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
  redirect(withQuery(returnUrl, "created", "edit"));
}

export async function reopenSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_reopen_session", { p_session_id: sessionId });
  if (error) redirect(withQuery(returnUrl, "error", error.message));
  revalidatePath("/admin/agenda");
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(withQuery(returnUrl, "created", "reopened"));
}

export async function cancelSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const scope = String(formData.get("scope") ?? "single");
  const returnUrl = sessionManagementReturn(formData, sessionId);
  if (!sessionId || !reason)
    redirect(withQuery(returnUrl, "error", "cancellation_reason_required"));
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,starts_at,recurring_schedule_id")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session) redirect(returnUrl);
  const { data: future } =
    scope === "future" && session.recurring_schedule_id
      ? await supabase
          .from("class_sessions")
          .select("id")
          .eq("studio_id", studio.id)
          .eq("recurring_schedule_id", session.recurring_schedule_id)
          .gte("starts_at", session.starts_at)
          .eq("status", "scheduled")
      : { data: [session] };
  for (const target of future ?? []) {
    const { error } = await supabase.rpc("admin_cancel_session", {
      target_session_id: target.id,
      reason,
    });
    if (error) redirect(withQuery(returnUrl, "error", error.message));
  }
  if (scope === "future" && session.recurring_schedule_id) {
    const { error } = await supabase
      .from("recurring_schedules")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", session.recurring_schedule_id)
      .eq("studio_id", studio.id);
    if (error) redirect(withQuery(returnUrl, "error", error.message));
  }
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
