import { withSupabase } from "npm:@supabase/server@1.7.0";

import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";

type ProcessStudentCreatedRequest = {
  eventId?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONSUMER_KEY = "integration.asistian.student-contact-upsert";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

    let payload: ProcessStudentCreatedRequest;
    try {
      payload = (await request.json()) as ProcessStudentCreatedRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const eventId = safeText(payload.eventId);
    if (!eventId || !UUID_PATTERN.test(eventId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const { data: event, error: eventError } = await adminClient
      .from("domain_events")
      .select(
        "event_id,studio_id,event_type,source_entity_type,source_entity_id,occurred_at,payload",
      )
      .eq("event_id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return jsonResponse({ error: "student_event_not_found" }, 404);
    }

    if (
      event.event_type !== "student.created" ||
      event.source_entity_type !== "student"
    ) {
      return jsonResponse({ error: "student_event_invalid" }, 409);
    }

    const studentId = safeText(event.source_entity_id);
    if (!studentId || !UUID_PATTERN.test(studentId)) {
      return jsonResponse({ error: "student_event_invalid" }, 409);
    }

    const { data: existingConsumption } = await adminClient
      .from("domain_event_consumptions")
      .select("event_id")
      .eq("event_id", eventId)
      .eq("consumer_key", CONSUMER_KEY)
      .maybeSingle();

    if (existingConsumption) {
      return jsonResponse({
        ok: true,
        outcome: "synced",
        eventId,
        studentId,
        reused: true,
      });
    }

    const { data: student, error: studentError } = await adminClient
      .from("students")
      .select("id,studio_id,person_id,full_name,phone,email,active,lifecycle_status,student_type")
      .eq("id", studentId)
      .eq("studio_id", event.studio_id)
      .maybeSingle();

    if (studentError || !student) {
      return jsonResponse({ error: "student_not_found" }, 404);
    }

    const { data: person, error: personError } = student.person_id
      ? await adminClient
          .from("persons")
          .select("first_name,last_name")
          .eq("id", student.person_id)
          .eq("studio_id", student.studio_id)
          .maybeSingle()
      : { data: null, error: null };

    if (personError) {
      return jsonResponse({ error: "student_identity_lookup_failed" }, 500);
    }

    const delivery = await sendAsistianWebhook({
      adminClient,
      studioId: student.studio_id,
      template: "student_contact_upsert",
      eventId,
      recipient: student.phone,
      variables: {
        student_id: student.id,
        nombre: student.full_name,
        first_name: safeText(person?.first_name) ?? student.full_name,
        last_name: safeText(person?.last_name),
        phone: student.phone,
        email: safeText(student.email),
        student_type: student.student_type,
        lifecycle_status: student.lifecycle_status,
        active: student.active,
      },
      metadata: {
        source: "studio_flow",
        entity: "student",
        operation: "upsert_contact",
        student_id: student.id,
      },
    });

    if (delivery.status !== "accepted") {
      return jsonResponse({
        ok: true,
        outcome: "error",
        eventId,
        studentId,
        retryable: delivery.status === "skipped" ? true : delivery.retryable,
        errorCode: delivery.errorCode,
      });
    }

    const { data: claimed, error: claimError } = await adminClient.rpc("claim_domain_event", {
      p_event_id: eventId,
      p_consumer_key: CONSUMER_KEY,
    });

    if (claimError) {
      return jsonResponse({ error: "domain_event_claim_failed" }, 500);
    }

    return jsonResponse({
      ok: true,
      outcome: "synced",
      eventId,
      studentId,
      provider: "asistian",
      providerReference: delivery.providerReference,
      claimed: claimed === true,
    });
  }),
};

export default handler;
