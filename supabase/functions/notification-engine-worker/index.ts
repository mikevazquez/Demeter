import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

const WORKER_ID_PREFIX = "notification-engine-worker";
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

type JsonObject = Record<string, unknown>;

type ClaimedProcessing = {
  processing_id: string;
  studio_id: string;
  event_id: string;
  attempt_count: number;
};

type DomainEvent = {
  event_id: string;
  studio_id: string;
  event_type: string;
  occurred_at: string;
  source_entity_type: string;
  source_entity_id: string;
  actor_user_id: string | null;
  payload: JsonObject;
  correlation_id: string | null;
  causation_event_id: string | null;
};

type RuleChannel = {
  channel_key: string;
  is_required: boolean;
  ordinal: number;
  channel_policy: JsonObject;
};

type NotificationRule = {
  rule_id: string;
  rule_key: string;
  event_type: string;
  version_number: number;
  notification_type: string;
  priority: "critical" | "normal" | "low";
  recipient_strategy_key: string;
  conditions: JsonObject;
  timing_strategy_key: string;
  timing_config: JsonObject;
  revalidation_strategy_key: string | null;
  template_key: string;
  expires_after_seconds: number | null;
  channels: RuleChannel[];
};

type Recipient = {
  recipientType: string;
  recipientEntityId: string | null;
  recipientUserId: string | null;
  snapshot: JsonObject;
};

type ReservationContext = {
  reservation: JsonObject | null;
  student: JsonObject | null;
  session: JsonObject | null;
  studio: JsonObject | null;
  template: JsonObject | null;
  discipline: JsonObject | null;
};

type EventContext = {
  event: DomainEvent;
  payload: JsonObject;
  reservation: JsonObject | null;
  student: JsonObject | null;
  session: JsonObject | null;
  studio: JsonObject | null;
  template: JsonObject | null;
  discipline: JsonObject | null;
};

function response(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeBatchSize(value: unknown) {
  const requested = safeNumber(value);
  if (requested === null) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(requested)));
}

function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (!isObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function valuesEqual(left: unknown, right: unknown) {
  if (
    (typeof left === "string" || typeof left === "number" || typeof left === "boolean") &&
    (typeof right === "string" || typeof right === "number" || typeof right === "boolean")
  ) {
    return String(left) === String(right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateCondition(node: unknown, context: EventContext): boolean {
  if (!isObject(node)) return false;

  if (Array.isArray(node.all)) {
    return node.all.every((condition) => evaluateCondition(condition, context));
  }

  if (Array.isArray(node.any)) {
    return node.any.some((condition) => evaluateCondition(condition, context));
  }

  const field = safeText(node.field);
  const operator = safeText(node.operator);
  if (!field || !operator) return false;

  const actual = getPath(context, field);
  const expected = node.value;

  switch (operator) {
    case "eq":
      return valuesEqual(actual, expected);
    case "neq":
      return !valuesEqual(actual, expected);
    case "exists":
      return expected === false
        ? actual === undefined || actual === null
        : actual !== undefined && actual !== null;
    case "in":
      return Array.isArray(expected) && expected.some((item) => valuesEqual(actual, item));
    case "not_in":
      return Array.isArray(expected) && !expected.some((item) => valuesEqual(actual, item));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = safeNumber(actual);
      const b = safeNumber(expected);
      if (a === null || b === null) return false;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
    default:
      throw new Error(`unsupported_condition_operator:${operator}`);
  }
}

function conditionsAllow(conditions: JsonObject, context: EventContext) {
  if (Object.keys(conditions).length === 0) return true;
  return evaluateCondition(conditions, context);
}

async function loadReservationContext(
  adminClient: SupabaseClient,
  event: DomainEvent,
): Promise<ReservationContext> {
  const payloadReservationId = safeText(event.payload.reservation_id);
  const reservationId =
    event.source_entity_type === "reservation" ? event.source_entity_id : payloadReservationId;

  if (!reservationId) {
    return {
      reservation: null,
      student: null,
      session: null,
      studio: null,
      template: null,
      discipline: null,
    };
  }

  const { data: reservation, error: reservationError } = await adminClient
    .from("reservations")
    .select("id,studio_id,session_id,student_id,student_user_id,status,booked_at,cancelled_at")
    .eq("id", reservationId)
    .eq("studio_id", event.studio_id)
    .maybeSingle();

  if (reservationError) throw new Error("reservation_context_lookup_failed");
  if (!reservation) {
    return {
      reservation: null,
      student: null,
      session: null,
      studio: null,
      template: null,
      discipline: null,
    };
  }

  const [{ data: student }, { data: session }, { data: studio }] = await Promise.all([
    reservation.student_id
      ? adminClient
          .from("students")
          .select("id,user_id,full_name,email,phone,active,lifecycle_status")
          .eq("id", reservation.student_id)
          .eq("studio_id", event.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    adminClient
      .from("class_sessions")
      .select("id,template_id,starts_at,ends_at,status,coach_user_id,instructor_id")
      .eq("id", reservation.session_id)
      .eq("studio_id", event.studio_id)
      .maybeSingle(),
    adminClient
      .from("studios")
      .select("id,name,timezone,locale")
      .eq("id", event.studio_id)
      .maybeSingle(),
  ]);

  const { data: template } = session?.template_id
    ? await adminClient
        .from("class_templates")
        .select("id,name,discipline_id")
        .eq("id", session.template_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle()
    : { data: null };

  const { data: discipline } = template?.discipline_id
    ? await adminClient
        .from("disciplines")
        .select("id,name")
        .eq("id", template.discipline_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle()
    : { data: null };

  return {
    reservation: reservation as JsonObject,
    student: (student ?? null) as JsonObject | null,
    session: (session ?? null) as JsonObject | null,
    studio: (studio ?? null) as JsonObject | null,
    template: (template ?? null) as JsonObject | null,
    discipline: (discipline ?? null) as JsonObject | null,
  };
}

async function buildContext(
  adminClient: SupabaseClient,
  event: DomainEvent,
): Promise<EventContext> {
  const reservationContext = await loadReservationContext(adminClient, event);
  return {
    event,
    payload: event.payload,
    ...reservationContext,
  };
}

async function resolveRecipients(
  adminClient: SupabaseClient,
  rule: NotificationRule,
  context: EventContext,
): Promise<Recipient[]> {
  switch (rule.recipient_strategy_key) {
    case "reservation_student": {
      const reservation = context.reservation;
      const student = context.student;
      if (!reservation || !student) return [];

      const studentId = safeText(student.id);
      const userId = safeText(student.user_id) ?? safeText(reservation.student_user_id);
      if (!studentId && !userId) return [];

      return [
        {
          recipientType: "student",
          recipientEntityId: studentId,
          recipientUserId: userId,
          snapshot: {
            student_id: studentId,
            user_id: userId,
            full_name: safeText(student.full_name),
            email: safeText(student.email),
            phone: safeText(student.phone),
          },
        },
      ];
    }

    case "event_actor_user": {
      if (!context.event.actor_user_id) return [];
      return [
        {
          recipientType: "user",
          recipientEntityId: null,
          recipientUserId: context.event.actor_user_id,
          snapshot: { user_id: context.event.actor_user_id },
        },
      ];
    }

    case "studio_admins": {
      const { data, error } = await adminClient
        .from("studio_memberships")
        .select("user_id,role")
        .eq("studio_id", context.event.studio_id)
        .eq("active", true)
        .in("role", ["owner", "admin"]);

      if (error) throw new Error("studio_admin_recipient_lookup_failed");

      return (data ?? []).map((item) => ({
        recipientType: "studio_admin",
        recipientEntityId: null,
        recipientUserId: item.user_id,
        snapshot: { user_id: item.user_id, role: item.role },
      }));
    }

    default:
      throw new Error(`unsupported_recipient_strategy:${rule.recipient_strategy_key}`);
  }
}

function resolveTiming(
  rule: NotificationRule,
  context: EventContext,
): {
  scheduledFor: string;
  expiresAt: string | null;
  suppressed: boolean;
  reasonCode: string | null;
} {
  const now = new Date();

  if (rule.timing_strategy_key === "immediate") {
    const expiresAt =
      rule.expires_after_seconds && rule.expires_after_seconds > 0
        ? new Date(now.getTime() + rule.expires_after_seconds * 1000).toISOString()
        : null;

    return {
      scheduledFor: now.toISOString(),
      expiresAt,
      suppressed: false,
      reasonCode: null,
    };
  }

  if (rule.timing_strategy_key === "before_session_start") {
    const startsAtText = safeText(context.session?.starts_at);
    const minutesBefore = safeNumber(rule.timing_config.minutes_before);
    const latePolicy = safeText(rule.timing_config.late_policy) ?? "skip";

    if (!startsAtText || minutesBefore === null || minutesBefore < 0 || minutesBefore > 10080) {
      throw new Error("before_session_start_config_invalid");
    }

    const startsAt = new Date(startsAtText);
    if (!Number.isFinite(startsAt.getTime())) throw new Error("session_start_invalid");

    const target = new Date(startsAt.getTime() - minutesBefore * 60_000);
    let expiresAt = startsAt;

    if (rule.expires_after_seconds && rule.expires_after_seconds > 0) {
      const relativeExpiry = new Date(target.getTime() + rule.expires_after_seconds * 1000);
      if (relativeExpiry < expiresAt) expiresAt = relativeExpiry;
    }

    if (now >= expiresAt) {
      return {
        scheduledFor: target.toISOString(),
        expiresAt: expiresAt.toISOString(),
        suppressed: true,
        reasonCode: "delivery_window_elapsed",
      };
    }

    if (target <= now) {
      if (latePolicy === "send_now") {
        return {
          scheduledFor: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          suppressed: false,
          reasonCode: null,
        };
      }

      if (latePolicy !== "skip") {
        throw new Error(`unsupported_late_policy:${latePolicy}`);
      }

      return {
        scheduledFor: target.toISOString(),
        expiresAt: expiresAt.toISOString(),
        suppressed: true,
        reasonCode: "scheduled_time_elapsed",
      };
    }

    return {
      scheduledFor: target.toISOString(),
      expiresAt: expiresAt.toISOString(),
      suppressed: false,
      reasonCode: null,
    };
  }

  throw new Error(`unsupported_timing_strategy:${rule.timing_strategy_key}`);
}

function buildTemplateVariables(context: EventContext, recipient: Recipient): JsonObject {
  return {
    recipient_name: safeText(recipient.snapshot.full_name),
    reservation_id: safeText(context.reservation?.id),
    session_id: safeText(context.session?.id) ?? safeText(context.payload.session_id),
    session_starts_at: safeText(context.session?.starts_at),
    session_ends_at: safeText(context.session?.ends_at),
    class_name: safeText(context.template?.name),
    discipline_name: safeText(context.discipline?.name),
    studio_name: safeText(context.studio?.name),
    studio_timezone: safeText(context.studio?.timezone),
  };
}

function recipientKey(recipient: Recipient) {
  return (
    recipient.recipientEntityId ??
    recipient.recipientUserId ??
    safeText(recipient.snapshot.email) ??
    safeText(recipient.snapshot.phone)
  );
}

async function recordRuleEvaluation(
  adminClient: SupabaseClient,
  input: {
    event: DomainEvent;
    rule: NotificationRule;
    outcome: "matched" | "not_matched" | "suppressed" | "error";
    reasonCode?: string | null;
    details?: JsonObject;
    recipientCount?: number;
    notificationsCreated?: number;
  },
) {
  const { error } = await adminClient.rpc("system_record_notification_rule_evaluation", {
    p_studio_id: input.event.studio_id,
    p_event_id: input.event.event_id,
    p_rule_id: input.rule.rule_id,
    p_rule_version_number: input.rule.version_number,
    p_outcome: input.outcome,
    p_reason_code: input.reasonCode ?? null,
    p_details: input.details ?? {},
    p_recipient_count: input.recipientCount ?? 0,
    p_notifications_created: input.notificationsCreated ?? 0,
  });

  if (error) throw new Error("rule_evaluation_record_failed");
}

async function processRule(
  adminClient: SupabaseClient,
  event: DomainEvent,
  rule: NotificationRule,
  context: EventContext,
) {
  if (!Array.isArray(rule.channels) || rule.channels.length === 0) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "error",
      reasonCode: "rule_has_no_active_channels",
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  if (!rule.channels.some((channel) => channel.is_required)) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "error",
      reasonCode: "rule_requires_required_channel",
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  let allowed = false;
  try {
    allowed = conditionsAllow(rule.conditions ?? {}, context);
  } catch (error) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "error",
      reasonCode: "condition_configuration_invalid",
      details: { error: error instanceof Error ? error.message : "unknown" },
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  if (!allowed) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "not_matched",
      reasonCode: "conditions_not_met",
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  let recipients: Recipient[];
  try {
    recipients = await resolveRecipients(adminClient, rule, context);
  } catch (error) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "error",
      reasonCode: "recipient_strategy_failed",
      details: { error: error instanceof Error ? error.message : "unknown" },
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  if (recipients.length === 0) {
    await recordRuleEvaluation(adminClient, {
      event,
      rule,
      outcome: "suppressed",
      reasonCode: "no_recipients",
    });
    return { created: 0, suppressed: 0, jobs: 0, duplicates: 0 };
  }

  let created = 0;
  let suppressed = 0;
  let jobs = 0;
  let duplicates = 0;

  for (const recipient of recipients) {
    const key = recipientKey(recipient);
    if (!key) {
      suppressed += 1;
      continue;
    }

    let timing;
    try {
      timing = resolveTiming(rule, context);
    } catch (error) {
      await recordRuleEvaluation(adminClient, {
        event,
        rule,
        outcome: "error",
        reasonCode: "timing_configuration_invalid",
        details: { error: error instanceof Error ? error.message : "unknown" },
        recipientCount: recipients.length,
        notificationsCreated: created,
      });
      return { created, suppressed, jobs, duplicates };
    }

    const deduplicationKey = [
      "notification",
      event.event_id,
      rule.rule_id,
      String(rule.version_number),
      recipient.recipientType,
      key,
    ].join(":");

    const { data, error } = await adminClient.rpc("system_materialize_notification", {
      p_studio_id: event.studio_id,
      p_source_event_id: event.event_id,
      p_rule_id: rule.rule_id,
      p_rule_version_number: rule.version_number,
      p_notification_type: rule.notification_type,
      p_recipient_type: recipient.recipientType,
      p_recipient_entity_id: recipient.recipientEntityId,
      p_recipient_user_id: recipient.recipientUserId,
      p_recipient_snapshot: recipient.snapshot,
      p_priority: rule.priority,
      p_scheduled_for: timing.scheduledFor,
      p_expires_at: timing.expiresAt,
      p_template_key: rule.template_key,
      p_template_variables: buildTemplateVariables(context, recipient),
      p_deduplication_key: deduplicationKey,
      p_channels: timing.suppressed ? [] : rule.channels,
      p_suppressed: timing.suppressed,
      p_reason_code: timing.reasonCode,
      p_reason_detail: timing.suppressed ? "Timing policy suppressed delivery." : null,
    });

    if (error) throw new Error(`notification_materialization_failed:${error.message}`);

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.created === true) {
      created += 1;
      jobs += Number(result.jobs_created ?? 0);
      if (timing.suppressed) suppressed += 1;
    } else {
      duplicates += 1;
    }
  }

  await recordRuleEvaluation(adminClient, {
    event,
    rule,
    outcome: suppressed > 0 && jobs === 0 ? "suppressed" : "matched",
    reasonCode: suppressed > 0 && jobs === 0 ? "timing_suppressed" : null,
    recipientCount: recipients.length,
    notificationsCreated: created,
    details: { jobs_created: jobs, duplicates_skipped: duplicates, suppressed },
  });

  return { created, suppressed, jobs, duplicates };
}

async function loadEvent(adminClient: SupabaseClient, eventId: string): Promise<DomainEvent> {
  const { data, error } = await adminClient
    .from("domain_events")
    .select(
      "event_id,studio_id,event_type,occurred_at,source_entity_type,source_entity_id,actor_user_id,payload,correlation_id,causation_event_id",
    )
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) throw new Error("domain_event_not_found");

  return {
    ...data,
    payload: isObject(data.payload) ? data.payload : {},
  } as DomainEvent;
}

async function loadRules(
  adminClient: SupabaseClient,
  event: DomainEvent,
): Promise<NotificationRule[]> {
  const { data, error } = await adminClient.rpc("service_get_notification_rules_for_event", {
    p_studio_id: event.studio_id,
    p_event_type: event.event_type,
  });

  if (error) throw new Error("notification_rule_lookup_failed");
  return Array.isArray(data) ? (data as NotificationRule[]) : [];
}

async function proactivelyInvalidate(adminClient: SupabaseClient, event: DomainEvent) {
  if (event.event_type !== "booking.cancelled" || event.source_entity_type !== "reservation") {
    return 0;
  }

  const { data, error } = await adminClient.rpc("system_cancel_pending_notifications_for_source", {
    p_studio_id: event.studio_id,
    p_source_entity_type: "reservation",
    p_source_entity_id: event.source_entity_id,
    p_reason_code: "reservation_cancelled",
    p_reason_detail: "Reservation was cancelled before delivery.",
  });

  if (error) throw new Error("notification_invalidation_failed");
  return Number(data ?? 0);
}

async function processClaim(
  adminClient: SupabaseClient,
  claim: ClaimedProcessing,
  workerId: string,
) {
  try {
    const event = await loadEvent(adminClient, claim.event_id);
    await proactivelyInvalidate(adminClient, event);

    const [rules, context] = await Promise.all([
      loadRules(adminClient, event),
      buildContext(adminClient, event),
    ]);

    let notificationsCreated = 0;
    let notificationsSuppressed = 0;
    let jobsCreated = 0;
    let duplicatesSkipped = 0;

    for (const rule of rules) {
      const result = await processRule(adminClient, event, rule, context);
      notificationsCreated += result.created;
      notificationsSuppressed += result.suppressed;
      jobsCreated += result.jobs;
      duplicatesSkipped += result.duplicates;
    }

    const { data: completed, error: completeError } = await adminClient.rpc(
      "system_complete_notification_event",
      {
        p_processing_id: claim.processing_id,
        p_worker_id: workerId,
        p_rules_evaluated: rules.length,
        p_notifications_created: notificationsCreated,
        p_notifications_suppressed: notificationsSuppressed,
        p_jobs_created: jobsCreated,
        p_duplicates_skipped: duplicatesSkipped,
      },
    );

    if (completeError || completed !== true) {
      throw new Error("notification_event_complete_failed");
    }

    return {
      ok: true,
      eventId: event.event_id,
      rulesEvaluated: rules.length,
      notificationsCreated,
      notificationsSuppressed,
      jobsCreated,
      duplicatesSkipped,
    };
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 1000) : "unknown_error";
    await adminClient.rpc("system_fail_notification_event", {
      p_processing_id: claim.processing_id,
      p_worker_id: workerId,
      p_error_code: "notification_engine_processing_failed",
      p_error_safe: safeError,
      p_retry_after_seconds: 60,
    });

    return {
      ok: false,
      eventId: claim.event_id,
      error: safeError,
    };
  }
}

const handler = {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);

    const adminClient = context.supabaseAdmin;
    const dispatchToken = safeText(request.headers.get("x-studio-flow-dispatch-token"));
    if (!dispatchToken) return response({ error: "unauthenticated" }, 401);

    const { data: authorized, error: authError } = await adminClient.rpc(
      "verify_automation_dispatch_token",
      { p_token: dispatchToken },
    );

    if (authError || authorized !== true) return response({ error: "forbidden" }, 403);

    let body: JsonObject = {};
    try {
      const parsed = await request.json();
      body = isObject(parsed) ? parsed : {};
    } catch {
      body = {};
    }

    const batchSize = safeBatchSize(body.limit);
    const workerId = `${WORKER_ID_PREFIX}:${crypto.randomUUID()}`;

    const { data: claims, error: claimError } = await adminClient.rpc(
      "system_claim_notification_events",
      {
        p_worker_id: workerId,
        p_limit: batchSize,
        p_lease_seconds: 120,
      },
    );

    if (claimError) {
      return response({ error: "notification_event_claim_failed" }, 500);
    }

    const claimed = (Array.isArray(claims) ? claims : []) as ClaimedProcessing[];
    const results = [];

    for (const claim of claimed) {
      results.push(await processClaim(adminClient, claim, workerId));
    }

    return response({
      ok: true,
      workerId,
      claimed: claimed.length,
      processed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    });
  }),
};

export default handler;
