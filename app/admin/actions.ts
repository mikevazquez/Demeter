"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { normalizeMexicanPhone } from "@/lib/phone";

const CANCELLATION_REASON_CODES = new Set([
  "schedule_conflict",
  "health",
  "work_school",
  "transport",
  "price",
  "lost_interest",
  "booking_error",
  "other",
  "prefer_not_say",
]);

function todayReturnUrl(returnDate: string) {
  return returnDate ? `/admin?date=${encodeURIComponent(returnDate)}` : "/admin";
}

function moneyToMinor(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimals = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

function withQuery(url: string, key: string, value: string) {
  const [base, hash] = url.split("#", 2);
  const next = `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  return hash ? `${next}#${hash}` : next;
}

function sessionReturnUrl(returnDate: string, sessionId: string) {
  const url = todayReturnUrl(returnDate);
  return sessionId ? `${url}#session-${sessionId}` : url;
}

function safeAdminReturn(value: string, fallback: string) {
  if (!value.startsWith("/admin")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

function operationReturnUrl(formData: FormData, returnDate: string, sessionId: string) {
  const fallback = sessionReturnUrl(returnDate, sessionId);
  return safeAdminReturn(String(formData.get("return_to") ?? ""), fallback);
}

function refreshSession(sessionId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/agenda/${sessionId}`);
}

const todayEligibilityCopy: Record<string, string> = {
  student_not_operable: "perfil no habilitado",
  session_not_bookable: "clase no disponible",
  already_reserved: "ya reservada",
  session_full: "clase llena",
  no_active_product: "sin paquete activo",
  enrollment_required: "inscripción no vigente",
  payment_pending: "pago pendiente",
  outside_product: "fuera de paquete",
  outside_product_schedule: "fuera de horario",
  no_credits: "sin créditos",
};

export type TodayStudentCandidate = {
  id: string;
  fullName: string;
  eligible: boolean;
  detail: string;
};

export async function searchStudentsForToday(
  sessionId: string,
  search: string,
): Promise<TodayStudentCandidate[]> {
  const normalizedSessionId = sessionId.trim();
  const normalizedSearch = search.trim();

  if (!normalizedSessionId || normalizedSearch.length < 2) return [];

  const { supabase, studio, can } = await getAdminContext();
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,status")
    .eq("studio_id", studio.id)
    .eq("id", normalizedSessionId)
    .maybeSingle();

  if (!session || session.status === "cancelled") return [];

  const canPostCloseAdd = session.status === "completed" && can(CAPABILITIES.ATTENDANCE_WRITE);
  if (!canPostCloseAdd && !can(CAPABILITIES.SCHEDULE_WRITE)) return [];

  const [{ data: students }, { data: existingReservations }] = await Promise.all([
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .ilike("full_name", `%${normalizedSearch}%`)
      .order("full_name")
      .limit(12),
    supabase
      .from("reservations")
      .select("student_id")
      .eq("session_id", normalizedSessionId)
      .in("status", ["reserved", "attended", "no_show"]),
  ]);

  const alreadyBooked = new Set(
    (existingReservations ?? []).flatMap((item) => (item.student_id ? [item.student_id] : [])),
  );
  const candidates = (students ?? []).filter((item) => !alreadyBooked.has(item.id)).slice(0, 8);

  if (canPostCloseAdd) {
    return candidates.map((student) => ({
      id: student.id,
      fullName: student.full_name,
      eligible: true,
      detail: "Disponible",
    }));
  }

  return Promise.all(
    candidates.map(async (student) => {
      const { data } = await supabase.rpc("booking_eligibility", {
        target_session_id: normalizedSessionId,
        target_student_id: student.id,
      });
      const eligibility = (data ?? {}) as {
        eligible?: boolean;
        reason_code?: string | null;
        available_credits?: number | null;
        unlimited?: boolean;
      };
      const reason = eligibility.reason_code
        ? (todayEligibilityCopy[eligibility.reason_code] ?? "no elegible")
        : "no elegible";

      return {
        id: student.id,
        fullName: student.full_name,
        eligible: eligibility.eligible === true,
        detail:
          eligibility.eligible === true
            ? eligibility.unlimited
              ? "membresía ilimitada"
              : `${eligibility.available_credits ?? 0} créditos`
            : reason,
      };
    }),
  );
}

export async function bookStudentFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);

  if (!sessionId || !studentId) {
    redirect(withQuery(returnUrl, "error", "booking"));
  }

  const { supabase, studio, can } = await getAdminContext();
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,status")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();

  if (!session) {
    redirect(returnUrl);
  }

  if (session.status === "completed") {
    if (!can(CAPABILITIES.ATTENDANCE_WRITE)) {
      redirect(withQuery(returnUrl, "error", "forbidden"));
    }

    const { data: result, error } = await supabase.rpc("admin_add_post_close_attendee", {
      target_session_id: sessionId,
      target_student_id: studentId,
    });

    if (error || !result?.ok || result?.status !== "attended") {
      redirect(withQuery(returnUrl, "error", error?.message ?? "post_close_attendee"));
    }

    refreshSession(sessionId);
    redirect(withQuery(returnUrl, "created", "post-close-attendee"));
  }

  if (!can(CAPABILITIES.SCHEDULE_WRITE)) {
    redirect(withQuery(returnUrl, "error", "forbidden"));
  }

  const { data: eligibility, error: eligibilityError } = await supabase.rpc("booking_eligibility", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });

  if (eligibilityError) {
    redirect(withQuery(returnUrl, "error", eligibilityError.message));
  }

  const result = (eligibility ?? {}) as {
    eligible?: boolean;
    reason_code?: string | null;
  };

  if (result.eligible === true) {
    const { error } = await supabase.rpc("admin_book_student", {
      target_session_id: sessionId,
      target_student_id: studentId,
    });

    if (error) {
      redirect(withQuery(returnUrl, "error", error.message));
    }

    refreshSession(sessionId);
    redirect(withQuery(returnUrl, "created", "booking"));
  }

  const commercialPendingReasons = new Set(["no_active_product", "outside_product", "no_credits"]);
  const reason = result.reason_code ?? "booking";

  if (!commercialPendingReasons.has(reason)) {
    redirect(withQuery(returnUrl, "error", reason));
  }

  if (!can(CAPABILITIES.ATTENDANCE_WRITE)) {
    redirect(withQuery(returnUrl, "error", "forbidden"));
  }

  const { error } = await supabase.rpc("add_existing_walkin_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });

  if (error) {
    redirect(withQuery(returnUrl, "error", error.message));
  }

  refreshSession(sessionId);
  redirect(withQuery(returnUrl, "created", "walkin-existing"));
}

export async function cancelReservationFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!sessionId || !reservationId || !CANCELLATION_REASON_CODES.has(reason)) {
    redirect(withQuery(returnUrl, "error", "cancel_reason_required"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data, error } = await supabase.rpc("cancel_reservation", {
    target_reservation_id: reservationId,
    target_reason: reason,
  });
  const result = data as { ok?: boolean; reason_code?: string | null } | null;

  if (error || result?.ok !== true) {
    redirect(withQuery(returnUrl, "error", result?.reason_code ?? "cancel"));
  }

  refreshSession(sessionId);
  revalidatePath("/admin/inteligencia");
  redirect(withQuery(returnUrl, "created", "cancel"));
}

export async function setAttendanceFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);

  if (!sessionId || !reservationId || !["attended", "no_show"].includes(status)) {
    redirect(withQuery(returnUrl, "error", "attendance"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data: attendanceResult, error } = await supabase.rpc("set_attendance_status", {
    target_reservation_id: reservationId,
    target_status: status,
    target_reason: reason || null,
  });

  if (error) {
    redirect(withQuery(returnUrl, "error", error.message));
  }

  const result = (attendanceResult ?? {}) as {
    ok?: boolean;
    status?: string;
    changed?: boolean;
  };

  if (result.ok !== true || result.status !== status || (reason && result.changed !== true)) {
    redirect(withQuery(returnUrl, "error", "attendance_not_persisted"));
  }

  const { data: persisted, error: persistenceError } = await supabase
    .from("reservations")
    .select("status")
    .eq("id", reservationId)
    .single();

  if (persistenceError || persisted?.status !== status) {
    redirect(withQuery(returnUrl, "error", "attendance_not_persisted"));
  }

  refreshSession(sessionId);
  redirect(withQuery(returnUrl, "created", reason ? "attendance-corrected" : status));
}

export async function recordPendingClassPaymentAndAttendanceFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const paymentMethod = String(formData.get("payment_method") ?? "")
    .trim()
    .toLowerCase();
  const paymentReference = String(formData.get("payment_reference") ?? "").trim();
  const paymentMinor = moneyToMinor(String(formData.get("payment_amount") ?? ""));
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);

  if (
    !sessionId ||
    !reservationId ||
    !["efectivo", "transferencia", "tarjeta", "otro"].includes(paymentMethod)
  ) {
    redirect(withQuery(returnUrl, "error", "payment_method_required"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("record_asistian_class_payment_and_attendance", {
    target_reservation_id: reservationId,
    payment_method: paymentMethod,
    payment_reference: paymentReference || null,
    payment_amount_minor: paymentMinor,
  });

  if (error) {
    const knownCodes = [
      "asistian_payment_required",
      "class_price_required",
      "payment_method_required",
      "payment_not_pending",
      "reservation_not_asistian",
      "session_not_started",
      "session_ended",
      "forbidden",
    ];
    const code = knownCodes.find((item) => error.message.includes(item)) ?? error.message;
    redirect(withQuery(returnUrl, "error", code));
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    status?: string;
    commercial_status?: string;
  };

  if (result.ok !== true || result.status !== "attended" || result.commercial_status !== "paid") {
    redirect(withQuery(returnUrl, "error", "attendance_payment_not_persisted"));
  }

  refreshSession(sessionId);
  revalidatePath("/admin/ventas");
  revalidatePath("/admin/alumnas");
  redirect(withQuery(returnUrl, "created", "paid-attendance"));
}

export async function createWalkinFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);

  if (!sessionId || !firstName || !phone) {
    redirect(withQuery(returnUrl, "error", "walkin_invalid"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("create_walkin_student", {
    target_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
  });

  if (error) {
    redirect(withQuery(returnUrl, "error", error.message));
  }

  refreshSession(sessionId);
  revalidatePath("/admin/alumnas");
  redirect(withQuery(returnUrl, "created", "walkin"));
}

export async function finalizeAttendanceFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = operationReturnUrl(formData, returnDate, sessionId);

  if (!sessionId) {
    redirect(withQuery(returnUrl, "error", "attendance"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("finalize_attendance", {
    target_session_id: sessionId,
  });

  if (error) {
    redirect(withQuery(returnUrl, "error", error.message));
  }

  refreshSession(sessionId);
  redirect(withQuery(returnUrl, "created", "attendance-finalized"));
}
