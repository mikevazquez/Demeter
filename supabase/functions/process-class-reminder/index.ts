import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";

const CLASS_REMINDER_TEMPLATE = "class_reminder";
const CLASS_REMINDER_CONSUMER_KEY = "sf.class_reminder_3h";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProcessClassReminderRequest = {
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

function joinName(firstName: unknown, lastName: unknown) {
  return [safeText(firstName), safeText(lastName)].filter(Boolean).join(" ") || null;
}

function isValidWhatsAppRecipient(recipient: string | null | undefined) {
  return /^\+[1-9][0-9]{7,14}$/.test(recipient?.trim() ?? "");
}

async function isConsumed(adminClient: SupabaseClient, eventId: string) {
  const { data } = await adminClient
    .from("domain_event_consumptions")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("consumer_key", CLASS_REMINDER_CONSUMER_KEY)
    .maybeSingle();

  return Boolean(data);
}

async function claimEvent(adminClient: SupabaseClient, eventId: string) {
  const { error } = await adminClient.rpc("claim_domain_event", {
    p_event_id: eventId,
    p_consumer_key: CLASS_REMINDER_CONSUMER_KEY,
  });
  return !error;
}

function formatReminderVariables(input: {
  studentName: string;
  discipline: string;
  startsAt: string;
  timeZone: string;
  locale?: string;
  coach: string | null;
  location: string | null;
}) {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) throw new Error("class_reminder_invalid_start_time");

  return {
    nombre: input.studentName.trim() || "Alumna",
    disciplina: input.discipline.trim(),
    fecha: new Intl.DateTimeFormat(input.locale || "es-MX", {
      timeZone: input.timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(startsAt),
    hora: new Intl.DateTimeFormat(input.locale || "es-MX", {
      timeZone: input.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(startsAt),
    coach: input.coach?.trim() || null,
    ubicacion: input.location?.trim() || null,
  };
}

async function loadContext(adminClient: SupabaseClient, reservationId: string) {
  const { data: reservation, error: reservationError } = await adminClient
    .from("reservations")
    .select("id,studio_id,session_id,student_id,status")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError || !reservation) {
    return { error: "reservation_not_found" as const };
  }

  const [{ data: student }, { data: session }, { data: studio }] = await Promise.all([
    reservation.student_id
      ? adminClient
          .from("students")
          .select("id,full_name,phone,active,lifecycle_status")
          .eq("id", reservation.student_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    adminClient
      .from("class_sessions")
      .select("id,template_id,instructor_id,space_id,starts_at,status")
      .eq("id", reservation.session_id)
      .eq("studio_id", reservation.studio_id)
      .maybeSingle(),
    adminClient
      .from("studios")
      .select("id,name,timezone,locale")
      .eq("id", reservation.studio_id)
      .maybeSingle(),
  ]);

  const { data: template } = session
    ? await adminClient
        .from("class_templates")
        .select("id,name,discipline_id")
        .eq("id", session.template_id)
        .eq("studio_id", reservation.studio_id)
        .maybeSingle()
    : { data: null };

  const { data: discipline } = template
    ? await adminClient
        .from("disciplines")
        .select("id,name")
        .eq("id", template.discipline_id)
        .eq("studio_id", reservation.studio_id)
        .maybeSingle()
    : { data: null };

  const [{ data: instructor }, { data: space }] = await Promise.all([
    session?.instructor_id
      ? adminClient
          .from("instructors")
          .select("id,person_id")
          .eq("id", session.instructor_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session?.space_id
      ? adminClient
          .from("spaces")
          .select("id,name,site_id")
          .eq("id", session.space_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const [{ data: instructorPerson }, { data: site }] = await Promise.all([
    instructor?.person_id
      ? adminClient
          .from("persons")
          .select("first_name,last_name")
          .eq("id", instructor.person_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    space?.site_id
      ? adminClient
          .from("sites")
          .select("name,address")
          .eq("id", space.site_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const location =
    [safeText(site?.name), safeText(space?.name), safeText(site?.address)]
      .filter(Boolean)
      .join(" · ") || safeText(studio?.name);

  return {
    reservation,
    student,
    session,
    studio,
    template,
    discipline,
    coach: joinName(instructorPerson?.first_name, instructorPerson?.last_name),
    location,
  };
}

const handler = {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const adminClient = context.supabaseAdmin;
    const dispatchToken = safeText(request.headers.get("x-studio-flow-dispatch-token"));
    if (!dispatchToken) return jsonResponse({ error: "unauthenticated" }, 401);

    const { data: dispatchAuthorized, error: dispatchAuthError } = await adminClient.rpc(
      "verify_automation_dispatch_token",
      {
        p_token: dispatchToken,
      },
    );

    if (dispatchAuthError || dispatchAuthorized !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    let payload: ProcessClassReminderRequest;
    try {
      payload = (await request.json()) as ProcessClassReminderRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const eventId = safeText(payload.eventId);
    if (!eventId || !UUID_PATTERN.test(eventId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    if (await isConsumed(adminClient, eventId)) {
      return jsonResponse({
        ok: true,
        outcome: "accepted",
        reused: true,
        eventId,
      });
    }

    const { data: event, error: eventError } = await adminClient
      .from("domain_events")
      .select("event_id,event_type,source_entity_type,source_entity_id,payload")
      .eq("event_id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return jsonResponse({ error: "class_reminder_event_not_found" }, 404);
    }

    if (event.event_type !== "class.reminder_due" || event.source_entity_type !== "reservation") {
      return jsonResponse({ error: "class_reminder_event_invalid" }, 409);
    }

    const reservationId = safeText(event.source_entity_id);
    if (!reservationId || !UUID_PATTERN.test(reservationId)) {
      return jsonResponse({ error: "class_reminder_event_invalid" }, 409);
    }

    const contextData = await loadContext(adminClient, reservationId);
    if ("error" in contextData) {
      return jsonResponse({ error: contextData.error }, 404);
    }

    const eligible =
      contextData.reservation.status === "reserved" &&
      contextData.session?.status === "scheduled" &&
      Boolean(contextData.student?.active) &&
      contextData.student?.lifecycle_status === "active" &&
      Boolean(contextData.session?.starts_at) &&
      Boolean(contextData.studio?.timezone) &&
      isValidWhatsAppRecipient(contextData.student?.phone);

    if (!eligible) {
      await claimEvent(adminClient, eventId);
      return jsonResponse({
        ok: true,
        outcome: "skipped",
        eventId,
        reason: "reservation_or_channel_not_eligible",
      });
    }

    const variables = formatReminderVariables({
      studentName: contextData.student?.full_name ?? "",
      discipline: contextData.discipline?.name ?? contextData.template?.name ?? "",
      startsAt: contextData.session?.starts_at ?? new Date().toISOString(),
      timeZone: contextData.studio?.timezone ?? "UTC",
      locale: contextData.studio?.locale ?? "es-MX",
      coach: contextData.coach,
      location: contextData.location,
    });

    const providerResult = await sendAsistianWebhook({
      adminClient,
      studioId: contextData.reservation.studio_id,
      template: CLASS_REMINDER_TEMPLATE,
      eventId,
      recipient: contextData.student?.phone ?? "",
      variables,
      metadata: {
        source: "class_reminder_3h",
        hours_before: 3,
        reservation_id: reservationId,
        session_id: contextData.reservation.session_id,
      },
    });

    if (providerResult.status === "accepted") {
      await claimEvent(adminClient, eventId);
      return jsonResponse({
        ok: true,
        outcome: "accepted",
        eventId,
        provider: "asistian",
      });
    }

    return jsonResponse({
      ok: true,
      outcome: "error",
      eventId,
      errorCode: providerResult.errorCode,
      retryable: providerResult.status === "skipped" ? true : providerResult.retryable,
    });
  }),
};

export default handler;
