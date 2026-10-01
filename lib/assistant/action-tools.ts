import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AssistantStudioContext } from "./read-tools";
import type {
  ExecuteBookingArgs,
  ExecuteCancellationArgs,
  ExecuteRescheduleArgs,
  ExecuteWaitlistJoinArgs,
  PrepareBookingArgs,
  PrepareCancellationArgs,
  PrepareRescheduleArgs,
  PrepareWaitlistJoinArgs,
} from "./tool-contracts";

type AssistantActionToolContext = {
  supabase: SupabaseClient;
  studio: AssistantStudioContext;
  conversationId: string;
  turnId: string;
  studentId: string | null;
  crmContactId: string | null;
  currentUserMessage: string;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOpaqueRef(value: unknown, prefix: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(
    new RegExp(
      `^${prefix}:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`,
      "i",
    ),
  );
  return match?.[1] ?? null;
}

function localParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
    time: `${map.get("hour")}:${map.get("minute")}`,
  };
}

function normalizeConfirmation(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExplicitAssistantConfirmation(value: string) {
  if (!value.trim() || value.includes("?")) return false;

  const normalized = normalizeConfirmation(value);
  if (!normalized) return false;

  const accepted = new Set([
    "si",
    "si por favor",
    "confirmo",
    "confirmado",
    "confirma",
    "confirmala",
    "adelante",
    "hazlo",
    "reservala",
    "reserva",
    "dale",
    "va",
    "ok",
    "okay",
    "de acuerdo",
    "correcto",
  ]);

  return accepted.has(normalized);
}

const BOOKING_REASON_MESSAGES: Record<string, string> = {
  session_not_found: "La clase ya no está disponible.",
  student_not_found: "No pude identificar a la alumna.",
  student_not_operable: "La cuenta no está habilitada para reservar.",
  session_not_bookable: "La clase ya no admite nuevas reservas.",
  already_reserved: "Ya existe una reserva para esa clase.",
  document_required: "Hay un documento pendiente antes de poder reservar.",
  enrollment_required: "Hace falta completar la inscripción requerida.",
  payment_pending: "Hay un pago pendiente que bloquea nuevas reservas.",
  no_active_product: "No hay un paquete o membresía vigente que cubra la clase.",
  outside_product: "El paquete vigente no aplica para esta actividad.",
  outside_product_schedule: "El paquete vigente no aplica para este horario.",
  session_full: "La clase ya está llena.",
  no_credits: "No hay créditos suficientes para reservar.",
  account_restricted: "La cuenta tiene una restricción que impide reservar.",
};

function safeBookingReason(reason: unknown) {
  const code = String(reason ?? "booking_not_eligible");
  return {
    reason_code: code,
    reason_message:
      BOOKING_REASON_MESSAGES[code] ??
      "Studio Flow indicó que esta reserva no puede realizarse.",
  };
}

async function getSessionSummary(
  ctx: AssistantActionToolContext,
  sessionId: string,
) {
  const { data: session, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select(
      "id,template_id,starts_at,ends_at,status,requires_resource,location_id,space_id",
    )
    .eq("id", sessionId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (sessionError || !session) return null;

  const [{ data: template }, { data: location }, { data: space }] =
    await Promise.all([
      ctx.supabase
        .from("class_templates")
        .select("name,credit_cost,drop_in_price_minor")
        .eq("id", session.template_id)
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      session.location_id
        ? ctx.supabase
            .from("studio_locations")
            .select("name")
            .eq("id", session.location_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.space_id
        ? ctx.supabase
            .from("spaces")
            .select("name")
            .eq("id", session.space_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const start = localParts(session.starts_at, ctx.studio.timezone);
  const end = localParts(session.ends_at, ctx.studio.timezone);

  return {
    session,
    summary: {
      activity: template?.name ?? "Clase",
      date: start.date,
      starts_at_local: start.time,
      ends_at_local: end.time,
      credit_cost: Math.max(Number(template?.credit_cost ?? 1), 1),
      drop_in_price_minor:
        template?.drop_in_price_minor == null
          ? null
          : Number(template.drop_in_price_minor),
      currency: ctx.studio.currency,
      location: location?.name ?? null,
      space: space?.name ?? null,
      timezone: ctx.studio.timezone,
    },
  };
}

async function prepareBooking(
  ctx: AssistantActionToolContext,
  args: PrepareBookingArgs,
) {
  let studentId = ctx.studentId;
  let resolvedStudentType: string | null = null;

  if (!studentId && ctx.crmContactId) {
    const nowIso = new Date().toISOString();
    const { data: requiredDocuments, error: documentError } = await ctx.supabase
      .from("document_versions")
      .select("id,document_id,enforcement_scope,response_mode,audience_scope")
      .eq("studio_id", ctx.studio.id)
      .in("status", ["active", "scheduled"])
      .not("published_at", "is", null)
      .lte("published_at", nowIso)
      .is("retired_at", null)
      .neq("response_mode", "informational")
      .eq("audience_scope", "all")
      .eq("enforcement_scope", "global_booking")
      .limit(1);

    if (!documentError && (requiredDocuments?.length ?? 0) > 0) {
      return {
        ok: false,
        error: "onboarding_required",
        onboarding_required: true,
        reason_code: "document_required",
        reason_message:
          "Necesitas activar tu acceso y completar los documentos obligatorios antes de reservar.",
        requires_access_provisioning: true,
      };
    }

    const { data: ensured, error: ensureError } = await ctx.supabase.rpc(
      "assistant_ensure_trial_student",
      {
        target_studio_id: ctx.studio.id,
        target_crm_contact_id: ctx.crmContactId,
      },
    );

    const ensuredObject = asObject(ensured);
    if (ensureError || !ensuredObject || ensuredObject.ok !== true) {
      return {
        ok: false,
        error: "trial_identity_create_failed",
        reason_code: String(ensuredObject?.reason_code ?? "trial_identity_create_failed"),
      };
    }

    studentId = String(ensuredObject.student_id ?? "") || null;
    resolvedStudentType = String(ensuredObject.student_type ?? "") || "trial";

    if (!studentId) {
      return { ok: false, error: "trial_identity_create_failed" };
    }

    ctx.studentId = studentId;
    await ctx.supabase
      .from("assistant_conversations")
      .update({
        student_id: studentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.conversationId)
      .eq("studio_id", ctx.studio.id);
  }

  if (!studentId) {
    return { ok: false, error: "identity_required" };
  }

  if (!resolvedStudentType) {
    const { data: student } = await ctx.supabase
      .from("students")
      .select("student_type")
      .eq("id", studentId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle();
    resolvedStudentType = student?.student_type ?? null;
  }

  const sessionId = parseOpaqueRef(args.session_ref, "session");
  if (!sessionId) {
    return { ok: false, error: "invalid_session_ref" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) {
    return { ok: false, error: "session_not_found" };
  }

  if (sessionInfo.session.requires_resource) {
    return {
      ok: false,
      error: "resource_selection_required",
      message:
        "Esta clase requiere seleccionar un recurso antes de reservar. El flujo de recursos todavía no está habilitado para Demi.",
    };
  }

  const { data: eligibility, error: eligibilityError } = await ctx.supabase.rpc(
    "booking_eligibility",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );

  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const eligibilityReason = String(eligibilityObject?.reason_code ?? "");
  const commercialPendingReasons = new Set([
    "no_active_product",
    "outside_product",
    "outside_product_schedule",
    "no_credits",
    "payment_pending",
    "enrollment_required",
  ]);
  const commercialPending =
    eligibilityObject?.eligible !== true &&
    resolvedStudentType === "trial" &&
    commercialPendingReasons.has(eligibilityReason);

  if (!eligibilityObject || (eligibilityObject.eligible !== true && !commercialPending)) {
    const safeReason = safeBookingReason(eligibilityReason);
    return {
      ok: false,
      error:
        ["document_required", "birth_date_required", "guardian_required"].includes(
          eligibilityReason,
        )
          ? "onboarding_required"
          : "booking_not_eligible",
      onboarding_required: [
        "document_required",
        "birth_date_required",
        "guardian_required",
      ].includes(eligibilityReason),
      ...safeReason,
    };
  }

  const confirmationSummary = {
    ...sessionInfo.summary,
    commercial_status: commercialPending ? "payment_pending" : "package_covered",
    payment_pending: commercialPending,
    eligibility_reason: commercialPending ? eligibilityReason : null,
  };

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.create")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.create",
      action_token_hash: tokenHash,
      action_payload: {
        session_id: sessionId,
        student_id: studentId,
        commercial_pending: commercialPending,
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: confirmationSummary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary: confirmationSummary,
  };
}

async function executeBooking(
  ctx: AssistantActionToolContext,
  args: ExecuteBookingArgs,
) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select(
      "id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.create")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending" || pending.action_type !== "booking.create") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const sessionId = String(payload.session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) {
    return { ok: false, error: "session_not_found" };
  }
  if (sessionInfo.session.requires_resource) {
    return { ok: false, error: "resource_selection_required" };
  }

  const { data: eligibility, error: eligibilityError } = await ctx.supabase.rpc(
    "booking_eligibility",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );
  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const eligibilityReason = String(eligibilityObject?.reason_code ?? "");
  const requestedCommercialPending = payload.commercial_pending === true;
  const commercialPendingReasons = new Set([
    "no_active_product",
    "outside_product",
    "outside_product_schedule",
    "no_credits",
    "payment_pending",
    "enrollment_required",
  ]);
  const canBookCommercialPending =
    requestedCommercialPending &&
    eligibilityObject?.eligible !== true &&
    commercialPendingReasons.has(eligibilityReason);

  let reservationId: string | null = null;
  let finalCommercialStatus = "package_covered";

  if (eligibilityObject?.eligible === true) {
    const { data, error: bookingError } = await ctx.supabase.rpc(
      "admin_book_student",
      {
        target_session_id: sessionId,
        target_student_id: studentId,
      },
    );

    if (bookingError || !data) {
      return { ok: false, error: "booking_execution_failed" };
    }
    reservationId = String(data);
  } else if (canBookCommercialPending) {
    const { data, error: pendingBookingError } = await ctx.supabase.rpc(
      "assistant_book_payment_pending",
      {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: studentId,
        target_assistant_conversation_id: ctx.conversationId,
      },
    );
    const pendingBooking = asObject(data);

    if (
      pendingBookingError ||
      !pendingBooking ||
      pendingBooking.ok !== true ||
      !pendingBooking.reservation_id
    ) {
      return {
        ok: false,
        error: "booking_execution_failed",
        ...safeBookingReason(pendingBooking?.reason_code ?? eligibilityReason),
      };
    }

    reservationId = String(pendingBooking.reservation_id);
    finalCommercialStatus = "payment_pending";
  } else {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: false,
      error: "booking_no_longer_eligible",
      ...safeBookingReason(eligibilityReason),
    };
  }

  if (!reservationId) {
    return { ok: false, error: "booking_execution_failed" };
  }

  const executedAt = new Date().toISOString();
  const reservationRef = `reservation:${reservationId}`;
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    commercial_status: finalCommercialStatus,
    summary: {
      ...sessionInfo.summary,
      commercial_status: finalCommercialStatus,
      payment_pending: finalCommercialStatus === "payment_pending",
    },
  };
}


type CancellationSnapshot = {
  reservationId: string;
  sessionId: string;
  status: string;
  summary: {
    activity: string;
    date: string;
    starts_at_local: string;
    ends_at_local: string;
    location: string | null;
    space: string | null;
    cancellation_status: "cancelled_on_time" | "cancelled_late";
    late: boolean;
    credit_cost: number;
    credit_will_return: boolean | null;
    unlimited_penalty_minor: number;
    currency: string;
    cancellation_cutoff_minutes: number;
  };
};

async function getCancellationSnapshot(
  ctx: AssistantActionToolContext,
  reservationId: string,
): Promise<CancellationSnapshot | null> {
  if (!ctx.studentId) return null;

  const { data: reservation, error: reservationError } = await ctx.supabase
    .from("reservations")
    .select("id,session_id,student_id,status,credits_held,acquisition_id")
    .eq("id", reservationId)
    .eq("studio_id", ctx.studio.id)
    .eq("student_id", ctx.studentId)
    .maybeSingle();

  if (reservationError || !reservation) return null;

  const { data: session, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,location_id,space_id")
    .eq("id", reservation.session_id)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (sessionError || !session) return null;

  const [templateResult, locationResult, spaceResult, policyResult, acquisitionResult] =
    await Promise.all([
      ctx.supabase
        .from("class_templates")
        .select("name")
        .eq("id", session.template_id)
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      session.location_id
        ? ctx.supabase
            .from("studio_locations")
            .select("name")
            .eq("id", session.location_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.space_id
        ? ctx.supabase
            .from("spaces")
            .select("name")
            .eq("id", session.space_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ctx.supabase
        .from("studio_operating_policies")
        .select(
          "cancellation_cutoff_minutes,late_cancellation_consumes_credit,unlimited_late_cancellation_penalty_minor",
        )
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      reservation.acquisition_id
        ? ctx.supabase
            .from("product_acquisitions")
            .select("unlimited")
            .eq("id", reservation.acquisition_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (templateResult.error || policyResult.error || acquisitionResult.error) {
    return null;
  }

  const cutoffMinutes = Math.max(
    Number(policyResult.data?.cancellation_cutoff_minutes ?? 0),
    0,
  );
  const late =
    Date.now() >
    new Date(session.starts_at).getTime() - cutoffMinutes * 60_000;
  const unlimited = Boolean(acquisitionResult.data?.unlimited);
  const creditCost = Math.max(Number(reservation.credits_held ?? 1), 1);
  const lateConsumesCredit = Boolean(
    policyResult.data?.late_cancellation_consumes_credit,
  );

  const start = localParts(session.starts_at, ctx.studio.timezone);
  const end = localParts(session.ends_at, ctx.studio.timezone);

  return {
    reservationId: reservation.id,
    sessionId: reservation.session_id,
    status: String(reservation.status),
    summary: {
      activity: templateResult.data?.name ?? "Clase",
      date: start.date,
      starts_at_local: start.time,
      ends_at_local: end.time,
      location: locationResult.data?.name ?? null,
      space: spaceResult.data?.name ?? null,
      cancellation_status: late ? "cancelled_late" : "cancelled_on_time",
      late,
      credit_cost: creditCost,
      credit_will_return: unlimited ? null : !(late && lateConsumesCredit),
      unlimited_penalty_minor:
        unlimited && late
          ? Math.max(
              Number(
                policyResult.data?.unlimited_late_cancellation_penalty_minor ?? 0,
              ),
              0,
            )
          : 0,
      currency: ctx.studio.currency,
      cancellation_cutoff_minutes: cutoffMinutes,
    },
  };
}

function cancellationConsequenceKey(snapshot: CancellationSnapshot["summary"]) {
  return JSON.stringify({
    cancellation_status: snapshot.cancellation_status,
    credit_will_return: snapshot.credit_will_return,
    unlimited_penalty_minor: snapshot.unlimited_penalty_minor,
    credit_cost: snapshot.credit_cost,
  });
}

async function prepareCancellation(
  ctx: AssistantActionToolContext,
  args: PrepareCancellationArgs,
) {
  if (!ctx.studentId) {
    return { ok: false, error: "identity_required" };
  }

  const reservationId = parseOpaqueRef(args.reservation_ref, "reservation");
  if (!reservationId) {
    return { ok: false, error: "invalid_reservation_ref" };
  }

  const reason = String(args.reason ?? "").trim();
  if (reason.length < 2 || reason.length > 240) {
    return { ok: false, error: "cancellation_reason_required" };
  }

  const snapshot = await getCancellationSnapshot(ctx, reservationId);
  if (!snapshot) {
    return { ok: false, error: "reservation_not_found" };
  }
  if (snapshot.status !== "reserved") {
    return { ok: false, error: "reservation_not_cancellable" };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.cancel")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const confirmationSummary = {
    ...snapshot.summary,
    reason,
  };

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.cancel",
      action_token_hash: tokenHash,
      action_payload: {
        reservation_id: reservationId,
        student_id: ctx.studentId,
        reason,
        prepared_turn_id: ctx.turnId,
        consequence_key: cancellationConsequenceKey(snapshot.summary),
      },
      confirmation_summary: confirmationSummary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary: confirmationSummary,
  };
}

async function executeCancellation(
  ctx: AssistantActionToolContext,
  args: ExecuteCancellationArgs,
) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select(
      "id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.cancel")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending" || pending.action_type !== "booking.cancel") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const reservationId = String(payload.reservation_id ?? "");
  const reason = String(payload.reason ?? "").trim();

  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }
  if (!reservationId || reason.length < 2) {
    return { ok: false, error: "pending_action_invalid" };
  }

  const snapshot = await getCancellationSnapshot(ctx, reservationId);
  if (!snapshot) {
    return { ok: false, error: "reservation_not_found" };
  }
  if (snapshot.status !== "reserved") {
    return { ok: false, error: "reservation_not_cancellable" };
  }

  const previousConsequence = String(payload.consequence_key ?? "");
  const currentConsequence = cancellationConsequenceKey(snapshot.summary);
  if (previousConsequence !== currentConsequence) {
    const refreshedAt = new Date().toISOString();
    const refreshedExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
    const refreshedSummary = { ...snapshot.summary, reason };

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        action_payload: {
          ...payload,
          prepared_turn_id: ctx.turnId,
          consequence_key: currentConsequence,
        },
        confirmation_summary: refreshedSummary,
        expires_at: refreshedExpiry,
        updated_at: refreshedAt,
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "confirmation_required",
      consequence_changed: true,
      expires_at: refreshedExpiry,
      summary: refreshedSummary,
    };
  }

  const { data: cancellation, error: cancellationError } = await ctx.supabase.rpc(
    "cancel_reservation",
    {
      target_reservation_id: reservationId,
      target_reason: reason,
    },
  );

  const cancellationObject = asObject(cancellation);
  if (
    cancellationError ||
    !cancellationObject ||
    cancellationObject.ok !== true
  ) {
    return {
      ok: false,
      error:
        String(cancellationObject?.reason_code ?? "") ||
        "cancellation_execution_failed",
    };
  }

  const executedAt = new Date().toISOString();
  const reservationRef = `reservation:${reservationId}`;
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    cancellation_status: cancellationObject.status,
    credit_cost: cancellationObject.credit_cost,
    summary: {
      ...snapshot.summary,
      reason,
    },
  };
}


async function prepareReschedule(
  ctx: AssistantActionToolContext,
  args: PrepareRescheduleArgs,
) {
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const reservationId = parseOpaqueRef(args.reservation_ref, "reservation");
  const targetSessionId = parseOpaqueRef(args.target_session_ref, "session");
  if (!reservationId) return { ok: false, error: "invalid_reservation_ref" };
  if (!targetSessionId) return { ok: false, error: "invalid_session_ref" };

  const source = await getCancellationSnapshot(ctx, reservationId);
  if (!source) return { ok: false, error: "reservation_not_found" };
  if (source.status !== "reserved") {
    return { ok: false, error: "reservation_not_reschedulable" };
  }
  if (source.sessionId === targetSessionId) {
    return { ok: false, error: "same_session" };
  }

  const target = await getSessionSummary(ctx, targetSessionId);
  if (!target) return { ok: false, error: "session_not_found" };
  if (target.session.requires_resource) {
    return { ok: false, error: "resource_selection_required" };
  }

  const { data: eligibility, error: eligibilityError } = await ctx.supabase.rpc(
    "booking_eligibility",
    {
      target_session_id: targetSessionId,
      target_student_id: ctx.studentId,
    },
  );
  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const reasonCode = String(eligibilityObject?.reason_code ?? "");
  const canUseReleasedCredit =
    reasonCode === "no_credits" && source.summary.credit_will_return === true;

  if (eligibilityObject?.eligible !== true && !canUseReleasedCredit) {
    return {
      ok: false,
      error: "reschedule_not_eligible",
      ...safeBookingReason(reasonCode),
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.reschedule")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const summary = {
    from: source.summary,
    to: target.summary,
    atomic: true,
    original_preserved_if_failed: true,
    target_may_use_released_credit: canUseReleasedCredit,
  };

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.reschedule",
      action_token_hash: tokenHash,
      action_payload: {
        reservation_id: reservationId,
        target_session_id: targetSessionId,
        student_id: ctx.studentId,
        prepared_turn_id: ctx.turnId,
        source_consequence_key: cancellationConsequenceKey(source.summary),
      },
      confirmation_summary: summary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary,
  };
}

async function executeReschedule(
  ctx: AssistantActionToolContext,
  args: ExecuteRescheduleArgs,
) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select(
      "id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.reschedule")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }
  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }
  if (pending.status !== "pending") {
    return { ok: false, error: "pending_action_not_available" };
  }
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };
  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }
  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const reservationId = String(payload.reservation_id ?? "");
  const targetSessionId = String(payload.target_session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const source = await getCancellationSnapshot(ctx, reservationId);
  const target = await getSessionSummary(ctx, targetSessionId);
  if (!source || source.status !== "reserved") {
    return { ok: false, error: "reservation_not_reschedulable" };
  }
  if (!target) return { ok: false, error: "session_not_found" };
  if (target.session.requires_resource) {
    return { ok: false, error: "resource_selection_required" };
  }

  const previousConsequence = String(payload.source_consequence_key ?? "");
  const currentConsequence = cancellationConsequenceKey(source.summary);
  if (previousConsequence !== currentConsequence) {
    const refreshedExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
    const refreshedSummary = {
      from: source.summary,
      to: target.summary,
      atomic: true,
      original_preserved_if_failed: true,
    };

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        action_payload: {
          ...payload,
          prepared_turn_id: ctx.turnId,
          source_consequence_key: currentConsequence,
        },
        confirmation_summary: refreshedSummary,
        expires_at: refreshedExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "confirmation_required",
      consequence_changed: true,
      expires_at: refreshedExpiry,
      summary: refreshedSummary,
    };
  }

  const { data: eligibility, error: eligibilityError } = await ctx.supabase.rpc(
    "booking_eligibility",
    {
      target_session_id: targetSessionId,
      target_student_id: studentId,
    },
  );
  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const reasonCode = String(eligibilityObject?.reason_code ?? "");
  const canUseReleasedCredit =
    reasonCode === "no_credits" && source.summary.credit_will_return === true;

  if (eligibilityObject?.eligible !== true && !canUseReleasedCredit) {
    return {
      ok: false,
      error: "reschedule_no_longer_eligible",
      original_reservation_preserved: true,
      ...safeBookingReason(reasonCode),
    };
  }

  const { data: result, error: rescheduleError } = await ctx.supabase.rpc(
    "admin_reschedule_student_reservation",
    {
      target_reservation_id: reservationId,
      target_session_id: targetSessionId,
      target_reason: "Reagendado por Demi",
    },
  );

  const resultObject = asObject(result);
  if (rescheduleError || !resultObject || resultObject.ok !== true) {
    return {
      ok: false,
      error: "reschedule_execution_failed",
      original_reservation_preserved: true,
    };
  }

  const newReservationId = String(resultObject.target_reservation_id ?? "");
  const executedAt = new Date().toISOString();
  const reservationRef = newReservationId
    ? `reservation:${newReservationId}`
    : null;

  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    source_status: resultObject.source_status,
    summary: {
      from: source.summary,
      to: target.summary,
    },
  };
}


function safeWaitlistReason(reason: unknown) {
  const code = String(reason ?? "waitlist_not_eligible");
  const messages: Record<string, string> = {
    session_not_found: "La clase ya no está disponible.",
    session_not_bookable: "La clase ya no admite lista de espera.",
    student_not_found: "No pude identificar a la alumna.",
    student_not_operable: "La cuenta no está habilitada para usar lista de espera.",
    already_reserved: "Ya tienes una reserva para esa clase.",
    module_not_enabled: "La lista de espera no está habilitada para este estudio.",
    seat_available: "Ya hay un lugar disponible; no hace falta entrar a lista de espera.",
    document_required: "Hay un documento pendiente antes de poder usar la lista de espera.",
    enrollment_required: "Hace falta completar la inscripción requerida.",
    payment_pending: "Hay un pago pendiente que bloquea esta acción.",
    no_active_product: "No hay un paquete o membresía vigente que cubra la clase.",
    outside_product: "El paquete vigente no aplica para esta actividad.",
    no_credits: "No hay créditos suficientes para entrar a la lista de espera.",
    account_restricted: "La cuenta tiene una restricción que impide entrar a la lista.",
  };

  return {
    reason_code: code,
    reason_message:
      messages[code] ??
      "Studio Flow indicó que no puedes entrar a la lista de espera de esta clase.",
  };
}

async function prepareWaitlistJoin(
  ctx: AssistantActionToolContext,
  args: PrepareWaitlistJoinArgs,
) {
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const sessionId = parseOpaqueRef(args.session_ref, "session");
  if (!sessionId) return { ok: false, error: "invalid_session_ref" };

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) return { ok: false, error: "session_not_found" };

  const { data: preview, error: previewError } = await ctx.supabase.rpc(
    "admin_waitlist_preview",
    {
      target_session_id: sessionId,
      target_student_id: ctx.studentId,
    },
  );

  if (previewError) {
    return { ok: false, error: "waitlist_preview_unavailable" };
  }

  const previewObject = asObject(preview);
  if (!previewObject || previewObject.ok !== true) {
    return {
      ok: false,
      error: "waitlist_not_eligible",
      ...safeWaitlistReason(previewObject?.reason_code),
    };
  }

  const summary = {
    ...sessionInfo.summary,
    waitlist: true,
    class_is_full: true,
    credit_cost: Number(previewObject.credit_cost ?? sessionInfo.summary.credit_cost ?? 1),
    credit_charged_now: false,
  };

  if (previewObject.reused === true) {
    return {
      ok: true,
      status: "already_active",
      reused: true,
      summary,
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "waitlist.join")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "waitlist.join",
      action_token_hash: tokenHash,
      action_payload: {
        session_id: sessionId,
        student_id: ctx.studentId,
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: summary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary,
  };
}

async function executeWaitlistJoin(
  ctx: AssistantActionToolContext,
  args: ExecuteWaitlistJoinArgs,
) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select(
      "id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "waitlist.join")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      waitlist_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const sessionId = String(payload.session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) return { ok: false, error: "session_not_found" };

  const { data: preview, error: previewError } = await ctx.supabase.rpc(
    "admin_waitlist_preview",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );

  if (previewError) {
    return { ok: false, error: "waitlist_preview_unavailable" };
  }

  const previewObject = asObject(preview);
  if (!previewObject || previewObject.ok !== true) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: false,
      error: "waitlist_no_longer_eligible",
      ...safeWaitlistReason(previewObject?.reason_code),
    };
  }

  if (previewObject.reused === true) {
    const executedAt = new Date().toISOString();
    const waitlistRef = previewObject.waitlist_entry_id
      ? `waitlist:${String(previewObject.waitlist_entry_id)}`
      : null;

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        status: "executed",
        confirmed_at: executedAt,
        executed_at: executedAt,
        execution_ref: waitlistRef,
        updated_at: executedAt,
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "executed",
      already_active: true,
      waitlist_ref: waitlistRef,
      summary: {
        ...sessionInfo.summary,
        waitlist: true,
        credit_charged_now: false,
      },
    };
  }

  const { data: joined, error: joinError } = await ctx.supabase.rpc(
    "admin_join_waitlist",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );

  const joinedObject = asObject(joined);
  if (joinError || !joinedObject || joinedObject.ok !== true) {
    return {
      ok: false,
      error: "waitlist_join_failed",
      ...safeWaitlistReason(joinedObject?.reason_code),
    };
  }

  const executedAt = new Date().toISOString();
  const waitlistRef = joinedObject.waitlist_entry_id
    ? `waitlist:${String(joinedObject.waitlist_entry_id)}`
    : null;

  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: waitlistRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    waitlist_ref: waitlistRef,
    summary: {
      ...sessionInfo.summary,
      waitlist: true,
      credit_charged_now: false,
    },
  };
}

export async function executeAssistantActionTool(
  ctx: AssistantActionToolContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    case "prepare_booking":
      return prepareBooking(ctx, args as PrepareBookingArgs);
    case "execute_booking":
      return executeBooking(ctx, args as ExecuteBookingArgs);
    case "prepare_cancellation":
      return prepareCancellation(ctx, args as PrepareCancellationArgs);
    case "execute_cancellation":
      return executeCancellation(ctx, args as ExecuteCancellationArgs);
    case "prepare_reschedule":
      return prepareReschedule(ctx, args as PrepareRescheduleArgs);
    case "execute_reschedule":
      return executeReschedule(ctx, args as ExecuteRescheduleArgs);
    case "prepare_waitlist_join":
      return prepareWaitlistJoin(ctx, args as PrepareWaitlistJoinArgs);
    case "execute_waitlist_join":
      return executeWaitlistJoin(ctx, args as ExecuteWaitlistJoinArgs);
    default:
      return { ok: false, error: "tool_not_allowed" };
  }
}
