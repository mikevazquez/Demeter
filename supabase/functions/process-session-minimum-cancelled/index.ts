import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";

const TEMPLATE = "class_cancelled_coach";
const CONSUMER_KEY = "minimum_reservation.coach_notification";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestBody = {
  eventId?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMexicanPhone(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;

  const digits = raw.replace(/\D/g, "");
  if (/^[1-9][0-9]{9}$/.test(digits)) return `+52${digits}`;
  if (/^52[1-9][0-9]{9}$/.test(digits)) return `+${digits}`;
  return null;
}

async function claimEvent(adminClient: SupabaseClient, eventId: string) {
  const { error } = await adminClient.rpc("claim_domain_event", {
    p_event_id: eventId,
    p_consumer_key: CONSUMER_KEY,
  });
  return !error;
}

async function isConsumed(adminClient: SupabaseClient, eventId: string) {
  const { data } = await adminClient
    .from("domain_event_consumptions")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("consumer_key", CONSUMER_KEY)
    .maybeSingle();
  return Boolean(data);
}

const handler = {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const adminClient = context.supabaseAdmin;
    const dispatchToken = safeText(request.headers.get("x-studio-flow-dispatch-token"));
    if (!dispatchToken) return jsonResponse({ error: "unauthenticated" }, 401);

    const { data: authorized, error: authError } = await adminClient.rpc(
      "verify_automation_dispatch_token",
      { p_token: dispatchToken },
    );

    if (authError || authorized !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const eventId = safeText(body.eventId);
    if (!eventId || !UUID_PATTERN.test(eventId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    if (await isConsumed(adminClient, eventId)) {
      return jsonResponse({ ok: true, outcome: "accepted", reused: true, eventId });
    }

    const { data: event, error: eventError } = await adminClient
      .from("domain_events")
      .select("event_id,studio_id,event_type,source_entity_type,source_entity_id,payload")
      .eq("event_id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return jsonResponse({ error: "event_not_found" }, 404);
    }

    if (
      event.event_type !== "session.minimum_cancelled" ||
      event.source_entity_type !== "class_session"
    ) {
      return jsonResponse({ error: "event_invalid" }, 409);
    }

    const { data: session } = await adminClient
      .from("class_sessions")
      .select(
        "id,studio_id,template_id,instructor_id,starts_at,minimum_reservations,minimum_reservations_at_review",
      )
      .eq("id", event.source_entity_id)
      .eq("studio_id", event.studio_id)
      .maybeSingle();

    if (!session) {
      await claimEvent(adminClient, eventId);
      return jsonResponse({ ok: true, outcome: "skipped", reason: "session_not_found" });
    }

    if (!session.instructor_id) {
      await claimEvent(adminClient, eventId);
      return jsonResponse({ ok: true, outcome: "skipped", reason: "coach_not_assigned" });
    }

    const [{ data: instructor }, { data: studio }, { data: template }] = await Promise.all([
      adminClient
        .from("instructors")
        .select("id,person_id,status")
        .eq("id", session.instructor_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle(),
      adminClient
        .from("studios")
        .select("id,name,timezone,locale")
        .eq("id", event.studio_id)
        .maybeSingle(),
      adminClient
        .from("class_templates")
        .select("id,name")
        .eq("id", session.template_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle(),
    ]);

    if (!instructor || instructor.status !== "active" || !studio || !template) {
      await claimEvent(adminClient, eventId);
      return jsonResponse({ ok: true, outcome: "skipped", reason: "coach_context_incomplete" });
    }

    const [{ data: person }, { data: phoneRows }] = await Promise.all([
      adminClient
        .from("persons")
        .select("id,first_name,last_name")
        .eq("id", instructor.person_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle(),
      adminClient
        .from("person_contacts")
        .select("value,is_primary")
        .eq("person_id", instructor.person_id)
        .eq("studio_id", event.studio_id)
        .eq("kind", "phone")
        .order("is_primary", { ascending: false }),
    ]);

    const recipient = normalizeMexicanPhone(phoneRows?.[0]?.value ?? null);
    if (!recipient) {
      await claimEvent(adminClient, eventId);
      return jsonResponse({ ok: true, outcome: "skipped", reason: "coach_phone_unavailable" });
    }

    const startsAt = new Date(session.starts_at);
    const timeZone = studio.timezone ?? "UTC";
    const locale = studio.locale ?? "es-MX";
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const minimum = Number(payload.minimum_required ?? session.minimum_reservations ?? 0) || 0;
    const reservationsAtReview =
      Number(payload.reservations_at_review ?? session.minimum_reservations_at_review ?? 0) || 0;
    const coachName =
      [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim() || "Coach";

    const variables = {
      coach: coachName,
      clase: template.name,
      fecha: new Intl.DateTimeFormat(locale, {
        timeZone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(startsAt),
      hora: new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(startsAt),
      minimo_reservas: minimum,
      reservas_al_revisar: reservationsAtReview,
      mensaje: "La clase fue cancelada. No necesitas asistir.",
    };

    const result = await sendAsistianWebhook({
      adminClient,
      studioId: event.studio_id,
      template: TEMPLATE,
      eventId,
      recipient,
      variables,
      metadata: {
        source: "minimum_reservation_cancellation",
        session_id: session.id,
        instructor_id: instructor.id,
      },
    });

    if (result.status === "accepted") {
      await claimEvent(adminClient, eventId);
      return jsonResponse({
        ok: true,
        outcome: "accepted",
        provider: "asistian",
        eventId,
      });
    }

    const retryable = result.status === "skipped" ? true : result.retryable;
    if (!retryable) await claimEvent(adminClient, eventId);

    return jsonResponse({
      ok: true,
      outcome: "error",
      eventId,
      errorCode: result.errorCode,
      retryable,
    });
  }),
};

export default handler;
