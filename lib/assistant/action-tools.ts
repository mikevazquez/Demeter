import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AssistantStudioContext } from "./read-tools";
import type {
  ExecuteBookingArgs,
  PrepareBookingArgs,
} from "./tool-contracts";

type AssistantActionToolContext = {
  supabase: SupabaseClient;
  studio: AssistantStudioContext;
  conversationId: string;
  turnId: string;
  studentId: string | null;
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
        .select("name,credit_cost")
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
  if (!ctx.studentId) {
    return { ok: false, error: "identity_required" };
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
      target_student_id: ctx.studentId,
    },
  );

  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  if (!eligibilityObject || eligibilityObject.eligible !== true) {
    return {
      ok: false,
      error: "booking_not_eligible",
      ...safeBookingReason(eligibilityObject?.reason_code),
    };
  }

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
        student_id: ctx.studentId,
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: sessionInfo.summary,
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
    summary: sessionInfo.summary,
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
  if (!eligibilityObject || eligibilityObject.eligible !== true) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: false,
      error: "booking_no_longer_eligible",
      ...safeBookingReason(eligibilityObject?.reason_code),
    };
  }

  const { data: reservationId, error: bookingError } = await ctx.supabase.rpc(
    "admin_book_student",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );

  if (bookingError || !reservationId) {
    return { ok: false, error: "booking_execution_failed" };
  }

  const executedAt = new Date().toISOString();
  const reservationRef = `reservation:${String(reservationId)}`;
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
    summary: sessionInfo.summary,
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
    default:
      return { ok: false, error: "tool_not_allowed" };
  }
}
