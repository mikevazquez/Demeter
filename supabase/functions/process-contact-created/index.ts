import { withSupabase } from "npm:@supabase/server@1.7.0";

import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";

type ProcessContactCreatedRequest = {
  eventId?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSUMER_KEY = "integration.asistian.contact-upsert";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
      { p_token: dispatchToken },
    );

    if (dispatchAuthError || dispatchAuthorized !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    let payload: ProcessContactCreatedRequest;
    try {
      payload = (await request.json()) as ProcessContactCreatedRequest;
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
      return jsonResponse({ error: "contact_event_not_found" }, 404);
    }

    if (
      event.event_type !== "contact.created" ||
      !["person", "student"].includes(event.source_entity_type)
    ) {
      return jsonResponse({ error: "contact_event_invalid" }, 409);
    }

    const eventPayload = safeRecord(event.payload);
    let personId =
      event.source_entity_type === "person" ? safeText(event.source_entity_id) : null;
    let studentId = safeText(eventPayload.student_id);

    if (personId && !UUID_PATTERN.test(personId)) personId = null;
    if (studentId && !UUID_PATTERN.test(studentId)) studentId = null;

    if (!personId && event.source_entity_type === "student") {
      studentId = safeText(event.source_entity_id);
      if (!studentId || !UUID_PATTERN.test(studentId)) {
        return jsonResponse({ error: "contact_event_invalid" }, 409);
      }
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
        contactId: personId ?? studentId,
        reused: true,
      });
    }

    let student = null;
    if (studentId) {
      const { data, error } = await adminClient
        .from("students")
        .select(
          "id,studio_id,person_id,full_name,phone,email,active,lifecycle_status,student_type",
        )
        .eq("id", studentId)
        .eq("studio_id", event.studio_id)
        .maybeSingle();

      if (error) return jsonResponse({ error: "contact_student_lookup_failed" }, 500);
      student = data;
      personId = personId ?? safeText(data?.person_id);
    } else if (personId) {
      const { data, error } = await adminClient
        .from("students")
        .select(
          "id,studio_id,person_id,full_name,phone,email,active,lifecycle_status,student_type",
        )
        .eq("studio_id", event.studio_id)
        .eq("person_id", personId)
        .neq("lifecycle_status", "archived")
        .order("created_at", { ascending: true })
        .limit(1);

      if (error) return jsonResponse({ error: "contact_student_lookup_failed" }, 500);
      student = data?.[0] ?? null;
      studentId = safeText(student?.id);
    }

    const [{ data: person, error: personError }, { data: contacts, error: contactsError }] =
      personId
        ? await Promise.all([
            adminClient
              .from("persons")
              .select("id,first_name,last_name")
              .eq("id", personId)
              .eq("studio_id", event.studio_id)
              .maybeSingle(),
            adminClient
              .from("person_contacts")
              .select("kind,value,is_primary,created_at")
              .eq("person_id", personId)
              .eq("studio_id", event.studio_id)
              .in("kind", ["phone", "email"])
              .order("is_primary", { ascending: false })
              .order("created_at", { ascending: true }),
          ])
        : [
            { data: null, error: null },
            { data: [], error: null },
          ];

    if (personError || contactsError) {
      return jsonResponse({ error: "contact_identity_lookup_failed" }, 500);
    }

    const { data: crmContact, error: crmError } = personId
      ? await adminClient
          .from("crm_contacts")
          .select("id,lifecycle_status,source,converted_student_id")
          .eq("studio_id", event.studio_id)
          .eq("person_id", personId)
          .maybeSingle()
      : { data: null, error: null };

    if (crmError) return jsonResponse({ error: "crm_contact_lookup_failed" }, 500);

    const phone =
      safeText(contacts?.find((contact) => contact.kind === "phone")?.value) ??
      safeText(student?.phone);
    const email =
      safeText(contacts?.find((contact) => contact.kind === "email")?.value) ??
      safeText(student?.email);

    if (!phone) {
      return jsonResponse({
        ok: true,
        outcome: "error",
        eventId,
        contactId: personId ?? studentId,
        retryable: true,
        errorCode: "contact_phone_missing",
      });
    }

    const firstName = safeText(person?.first_name);
    const lastName = safeText(person?.last_name);
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") || safeText(student?.full_name) || "Contacto";
    const lifecycleStatus =
      safeText(crmContact?.lifecycle_status) ??
      (student ? (student.student_type === "trial" ? "trial" : "student") : "contact");

    const delivery = await sendAsistianWebhook({
      adminClient,
      studioId: event.studio_id,
      template: "contact_upsert",
      eventId,
      recipient: phone,
      variables: {
        contact_id: personId ?? studentId,
        crm_contact_id: safeText(crmContact?.id),
        student_id: studentId,
        nombre: fullName,
        first_name: firstName ?? fullName,
        last_name: lastName,
        phone,
        email,
        lifecycle_status: lifecycleStatus,
        source: safeText(crmContact?.source) ?? safeText(eventPayload.source),
        active: student?.active ?? true,
      },
      metadata: {
        source: "studio_flow",
        entity: "contact",
        operation: "upsert_contact",
        person_id: personId,
        student_id: studentId,
        crm_contact_id: safeText(crmContact?.id),
      },
    });

    if (delivery.status !== "accepted") {
      return jsonResponse({
        ok: true,
        outcome: "error",
        eventId,
        contactId: personId ?? studentId,
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
      contactId: personId ?? studentId,
      provider: "asistian",
      providerReference: delivery.providerReference,
      claimed: claimed === true,
    });
  }),
};

export default handler;
