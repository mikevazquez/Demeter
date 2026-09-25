import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { sendPushNotification, WebPushError } from "npm:@mmmike/web-push@1.3.0/send";
import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";
import { sendMetaWhatsAppTemplate } from "../_shared/meta-whatsapp.ts";
import {
  buildAsistianVariables,
  formatNotificationDateTimeParts,
  normalizeAsistianPhone,
} from "../_shared/notification-asistian-variables.ts";

const WORKER_ID_PREFIX = "notification-delivery-worker";
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

type JsonObject = Record<string, unknown>;

type ClaimedJob = {
  job_id: string;
  studio_id: string;
  notification_id: string;
  channel_key: string;
  is_required: boolean;
  attempt_count: number;
  max_attempts: number;
};

type ClaimedDelivery = {
  delivery_id: string;
  studio_id: string;
  job_id: string;
  notification_id: string;
  channel_key: string;
  adapter_key: string;
  attempt_count: number;
  max_attempts: number;
};

type DeliveryRow = {
  id: string;
  studio_id: string;
  job_id: string;
  notification_id: string;
  source_event_id: string;
  channel_key: string;
  adapter_key: string;
  adapter_enabled: boolean;
  provider_key: string | null;
  notification_type: string;
  communication_class: "P0" | "P1" | "P2";
  priority: "critical" | "normal" | "low";
  recipient_type: string;
  recipient_entity_id: string | null;
  recipient_user_id: string | null;
  recipient_snapshot: JsonObject;
  template_key: string;
  template_variables: JsonObject;
  channel_policy: JsonObject;
  message_snapshot: JsonObject;
  state: string;
  expires_at: string | null;
};

type RenderedMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
  providerTemplateKey: string;
};

type AdapterResult =
  | {
      status: "accepted" | "delivered";
      providerKey: string;
      providerMessageId?: string | null;
      httpStatus?: number | null;
      response: JsonObject;
    }
  | {
      status: "retry";
      providerKey: string;
      errorCode: string;
      errorMessage?: string | null;
      httpStatus?: number | null;
      response: JsonObject;
    }
  | {
      status: "failed" | "skipped";
      providerKey: string;
      errorCode: string;
      errorMessage?: string | null;
      httpStatus?: number | null;
      response: JsonObject;
    };

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  expiration_time: number | null;
};

type VapidConfig = {
  public_key?: unknown;
  private_key?: unknown;
  subject?: unknown;
};

const ASISTIAN_TEMPLATES = new Set([
  "student_welcome",
  "reservation_confirmed",
  "reservation_cancelled",
  "waitlist_promoted",
  "class_reminder",
  "class_cancelled_coach",
]);

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

function safeUuid(value: unknown) {
  const text = safeText(value);
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function safeBatchSize(value: unknown) {
  const requested = safeNumber(value);
  if (requested === null) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(requested)));
}

function interpolate(value: string, variables: JsonObject) {
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const raw = variables[key];
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      return String(raw);
    }
    return "";
  });
}

function formatSessionStart(variables: JsonObject) {
  const startsAt = safeText(variables.session_starts_at);
  if (!startsAt) return null;

  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return startsAt;

  const timezone = safeText(variables.studio_timezone) ?? "UTC";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    })
      .format(date)
      .replace(/\.$/, "");
  } catch {
    return date.toISOString();
  }
}

function renderMessage(delivery: DeliveryRow): RenderedMessage {
  const variables = delivery.template_variables ?? {};
  const policy = delivery.channel_policy ?? {};

  const overrideTitle = safeText(policy.title_template);
  const overrideBody = safeText(policy.body_template);
  const overrideUrl = safeText(policy.url);
  const overrideProviderTemplate = safeText(policy.provider_template_key);

  if (overrideTitle && overrideBody) {
    return {
      title: interpolate(overrideTitle, variables),
      body: interpolate(overrideBody, variables),
      url: overrideUrl ?? (delivery.recipient_type === "student" ? "/student" : "/admin"),
      tag: `notification-${delivery.id}`,
      providerTemplateKey: overrideProviderTemplate ?? delivery.template_key,
    };
  }

  const className = safeText(variables.class_name) ?? "tu clase";
  const studioName = safeText(variables.studio_name) ?? "Studio Flow";
  const startLabel = formatSessionStart(variables);

  switch (delivery.template_key) {
    case "class_reminder":
      return {
        title: "Tu clase es pronto",
        body: startLabel ? `${className} comienza ${startLabel}.` : `${className} comienza pronto.`,
        url: delivery.recipient_type === "student" ? "/student" : "/admin/mis-clases",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "class_reminder",
      };

    case "reservation_confirmed":
      return {
        title: "Reserva confirmada",
        body: startLabel
          ? `Tu lugar en ${className} quedó reservado para ${startLabel}.`
          : `Tu lugar en ${className} quedó reservado.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "reservation_confirmed",
      };

    case "reservation_cancelled":
      return {
        title: "Reserva cancelada",
        body: `Tu reserva de ${className} fue cancelada.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "reservation_cancelled",
      };

    case "waitlist_promoted":
      return {
        title: "¡Ya tienes lugar!",
        body: startLabel
          ? `Se liberó un lugar en ${className} para ${startLabel}.`
          : `Se liberó un lugar en ${className}.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "waitlist_promoted",
      };

    case "student_welcome":
      return {
        title: `Bienvenida a ${studioName}`,
        body: "Tu acceso a Studio Flow está listo.",
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "student_welcome",
      };

    case "class_cancelled_coach":
      return {
        title: "Clase cancelada",
        body: startLabel
          ? `${className} de ${startLabel} fue cancelada.`
          : `${className} fue cancelada.`,
        url: "/admin/mis-clases",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "class_cancelled_coach",
      };

    case "class_rescheduled": {
      const oldLabel = formatNotificationDateTimeParts(
        variables.old_starts_at,
        variables.studio_timezone,
      ).label;
      return {
        title: "Cambio de horario",
        body:
          oldLabel && startLabel
            ? `${className} cambió de ${oldLabel} a ${startLabel}.`
            : startLabel
              ? `${className} ahora será ${startLabel}.`
              : `El horario de ${className} cambió.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "class_rescheduled",
      };
    }

    case "class_cancelled_student":
      return {
        title: "Tu clase fue cancelada",
        body: startLabel
          ? `${className} de ${startLabel} se canceló por no alcanzar el mínimo de reservas. Tu crédito fue restaurado cuando correspondía.`
          : `${className} se canceló por no alcanzar el mínimo de reservas. Tu crédito fue restaurado cuando correspondía.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "class_cancelled_student",
      };

    case "evaluation_invitation": {
      const discipline = safeText(variables.discipline_name) ?? "tu disciplina";
      return {
        title: "Tienes una evaluación disponible",
        body: `Ya puedes agendar tu evaluación de ${discipline} desde Studio Flow.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "evaluation_invitation",
      };
    }

    case "evaluation_scheduled": {
      const discipline = safeText(variables.discipline_name) ?? "tu disciplina";
      return {
        title: "Evaluación programada",
        body: startLabel
          ? `Tu evaluación de ${discipline} quedó programada para ${startLabel}.`
          : `Tu evaluación de ${discipline} quedó programada.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "evaluation_scheduled",
      };
    }

    case "evaluation_completed": {
      const discipline = safeText(variables.discipline_name) ?? "tu disciplina";
      return {
        title: "Resultados de evaluación disponibles",
        body: `Ya puedes consultar los resultados de tu evaluación de ${discipline} en Studio Flow.`,
        url: "/student",
        tag: `notification-${delivery.id}`,
        providerTemplateKey: overrideProviderTemplate ?? "evaluation_completed",
      };
    }

    default:
      throw new Error(`notification_template_unsupported:${delivery.template_key}`);
  }
}

async function loadDelivery(adminClient: SupabaseClient, deliveryId: string): Promise<DeliveryRow> {
  const { data, error } = await adminClient
    .from("notification_deliveries")
    .select(
      "id,studio_id,job_id,notification_id,source_event_id,channel_key,adapter_key,adapter_enabled,provider_key,notification_type,communication_class,priority,recipient_type,recipient_entity_id,recipient_user_id,recipient_snapshot,template_key,template_variables,channel_policy,message_snapshot,state,expires_at",
    )
    .eq("id", deliveryId)
    .maybeSingle();

  if (error || !data) throw new Error("notification_delivery_context_not_found");

  return {
    ...data,
    recipient_snapshot: isObject(data.recipient_snapshot) ? data.recipient_snapshot : {},
    template_variables: isObject(data.template_variables) ? data.template_variables : {},
    channel_policy: isObject(data.channel_policy) ? data.channel_policy : {},
    message_snapshot: isObject(data.message_snapshot) ? data.message_snapshot : {},
  } as DeliveryRow;
}

async function sendInbox(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
  message: RenderedMessage,
): Promise<AdapterResult> {
  const isStudent = delivery.recipient_type === "student" && Boolean(delivery.recipient_entity_id);
  const isInstructor =
    delivery.recipient_type === "instructor" && Boolean(delivery.recipient_entity_id);

  if (!isStudent && !isInstructor) {
    return {
      status: "skipped",
      providerKey: "studio_flow",
      errorCode: "inbox_recipient_unsupported",
      response: {},
    };
  }

  const deduplicationKey = `notification-delivery:${delivery.id}:inbox`;
  const newId = crypto.randomUUID();
  const sessionId = safeUuid(delivery.template_variables.session_id);
  const href = isStudent ? `/student/notificaciones/${newId}` : "/admin/mis-clases";
  const payload = {
    href,
    delivery_id: delivery.id,
    notification_id: delivery.notification_id,
    communication_class: delivery.communication_class,
  };

  const { error: insertError } = await adminClient.from("app_notifications").upsert(
    {
      id: newId,
      studio_id: delivery.studio_id,
      recipient_user_id: delivery.recipient_user_id,
      recipient_kind: isStudent ? "student" : "instructor",
      student_id: isStudent ? delivery.recipient_entity_id : null,
      instructor_id: isInstructor ? delivery.recipient_entity_id : null,
      session_id: sessionId,
      source_event_id: delivery.source_event_id,
      notification_type: delivery.notification_type,
      title: message.title,
      body: message.body,
      payload,
      deduplication_key: deduplicationKey,
    },
    {
      onConflict: "studio_id,deduplication_key",
      ignoreDuplicates: true,
    },
  );

  if (insertError) {
    return {
      status: "retry",
      providerKey: "studio_flow",
      errorCode: "inbox_persist_failed",
      errorMessage: insertError.message,
      response: {},
    };
  }

  const { data: existing, error: lookupError } = await adminClient
    .from("app_notifications")
    .select("id")
    .eq("studio_id", delivery.studio_id)
    .eq("deduplication_key", deduplicationKey)
    .maybeSingle();

  if (lookupError || !existing?.id) {
    return {
      status: "retry",
      providerKey: "studio_flow",
      errorCode: "inbox_persist_verify_failed",
      errorMessage: lookupError?.message ?? null,
      response: {},
    };
  }

  if (isStudent && existing.id !== newId) {
    await adminClient
      .from("app_notifications")
      .update({
        payload: {
          ...payload,
          href: `/student/notificaciones/${existing.id}`,
        },
      })
      .eq("id", existing.id);
  }

  return {
    status: "delivered",
    providerKey: "studio_flow",
    providerMessageId: existing.id,
    response: { persisted: true },
  };
}

async function sendPush(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
  message: RenderedMessage,
): Promise<AdapterResult> {
  if (!delivery.recipient_user_id) {
    return {
      status: "skipped",
      providerKey: "web_push",
      errorCode: "push_recipient_user_missing",
      response: {},
    };
  }

  const [{ data: subscriptions, error: subscriptionError }, { data: rawVapid, error: vapidError }] =
    await Promise.all([
      adminClient
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth_secret,expiration_time")
        .eq("studio_id", delivery.studio_id)
        .eq("user_id", delivery.recipient_user_id)
        .is("revoked_at", null),
      adminClient.rpc("service_get_push_vapid_config"),
    ]);

  if (subscriptionError) {
    return {
      status: "retry",
      providerKey: "web_push",
      errorCode: "push_subscription_lookup_failed",
      errorMessage: subscriptionError.message,
      response: {},
    };
  }

  if (vapidError) {
    return {
      status: "retry",
      providerKey: "web_push",
      errorCode: "push_vapid_lookup_failed",
      errorMessage: vapidError.message,
      response: {},
    };
  }

  const rows = (subscriptions ?? []) as PushSubscriptionRow[];
  if (rows.length === 0) {
    return {
      status: "skipped",
      providerKey: "web_push",
      errorCode: "push_subscription_missing",
      response: {},
    };
  }

  const vapid = (rawVapid ?? {}) as VapidConfig;
  const publicKey = safeText(vapid.public_key);
  const privateKey = safeText(vapid.private_key);
  const subject = safeText(vapid.subject);

  if (!publicKey || !privateKey || !subject) {
    return {
      status: "skipped",
      providerKey: "web_push",
      errorCode: "push_vapid_not_configured",
      response: {},
    };
  }

  let accepted = 0;
  let gone = 0;
  let failed = 0;

  const ttl = delivery.expires_at
    ? Math.max(
        60,
        Math.min(86400, Math.floor((new Date(delivery.expires_at).getTime() - Date.now()) / 1000)),
      )
    : 3600;

  await Promise.all(
    rows.map(async (row) => {
      try {
        const ok = await sendPushNotification(
          {
            endpoint: row.endpoint,
            expirationTime: row.expiration_time,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth_secret,
            },
          },
          {
            title: message.title,
            body: message.body,
            url: message.url,
            tag: message.tag,
          },
          {
            publicKey,
            privateKey,
            subject,
          },
          {
            ttl,
            urgency:
              delivery.priority === "critical"
                ? "high"
                : delivery.priority === "low"
                  ? "low"
                  : "normal",
          },
        );

        if (ok) {
          accepted += 1;
          return;
        }

        gone += 1;
        await adminClient.rpc("service_revoke_push_subscription", {
          p_subscription_id: row.id,
          p_reason: "push_endpoint_gone",
        });
      } catch (error) {
        if (
          error instanceof WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          gone += 1;
          await adminClient.rpc("service_revoke_push_subscription", {
            p_subscription_id: row.id,
            p_reason: "push_endpoint_gone",
          });
          return;
        }

        failed += 1;
      }
    }),
  );

  if (accepted > 0) {
    return {
      status: "accepted",
      providerKey: "web_push",
      providerMessageId: `webpush:${delivery.id}`,
      response: { accepted, gone, failed },
    };
  }

  if (failed > 0) {
    return {
      status: "retry",
      providerKey: "web_push",
      errorCode: "push_delivery_failed",
      response: { accepted, gone, failed },
    };
  }

  return {
    status: "skipped",
    providerKey: "web_push",
    errorCode: "push_no_active_endpoint",
    response: { accepted, gone, failed },
  };
}

async function resolveDeliveryAdapter(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
): Promise<DeliveryRow> {
  if (delivery.channel_key !== "whatsapp") return delivery;

  const requestedProvider = safeText(delivery.channel_policy.provider_key);
  const { data, error } = await adminClient.rpc("service_resolve_whatsapp_provider", {
    target_studio_id: delivery.studio_id,
    requested_provider: requestedProvider,
  });

  if (error) throw new Error("whatsapp_provider_resolution_failed");

  const provider = safeText(data) ?? "asistian";
  if (provider === "meta_whatsapp") {
    return {
      ...delivery,
      adapter_key: "meta_whatsapp",
      provider_key: "meta_whatsapp",
    };
  }

  return {
    ...delivery,
    adapter_key: "asistian",
    provider_key: "asistian",
  };
}

async function sendWhatsAppAsistian(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
  message: RenderedMessage,
): Promise<AdapterResult> {
  const phone = normalizeAsistianPhone(delivery.recipient_snapshot.phone);
  if (!phone) {
    return {
      status: "skipped",
      providerKey: "asistian",
      errorCode: "whatsapp_recipient_phone_missing",
      response: {},
    };
  }

  if (!ASISTIAN_TEMPLATES.has(message.providerTemplateKey)) {
    return {
      status: "failed",
      providerKey: "asistian",
      errorCode: "asistian_template_unsupported",
      response: { template_key: message.providerTemplateKey },
    };
  }

  const result = await sendAsistianWebhook({
    adminClient,
    studioId: delivery.studio_id,
    template: message.providerTemplateKey as
      | "student_welcome"
      | "reservation_confirmed"
      | "reservation_cancelled"
      | "waitlist_promoted"
      | "class_reminder"
      | "class_cancelled_coach",
    eventId: delivery.id,
    recipient: phone,
    variables: buildAsistianVariables(message.providerTemplateKey, delivery.template_variables),
    metadata: {
      notification_id: delivery.notification_id,
      delivery_id: delivery.id,
      communication_class: delivery.communication_class,
    },
  });

  if (result.status === "accepted") {
    return {
      status: "accepted",
      providerKey: "asistian",
      providerMessageId: result.providerReference,
      httpStatus: result.httpStatus,
      response: { accepted: true },
    };
  }

  if (result.status === "skipped") {
    return {
      status: "skipped",
      providerKey: "asistian",
      errorCode: result.errorCode,
      httpStatus: result.httpStatus ?? null,
      response: {},
    };
  }

  return {
    status: result.retryable ? "retry" : "failed",
    providerKey: "asistian",
    errorCode: result.errorCode,
    httpStatus: result.httpStatus ?? null,
    response: {},
  };
}

async function sendWhatsAppMeta(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
  message: RenderedMessage,
): Promise<AdapterResult> {
  const result = await sendMetaWhatsAppTemplate({
    adminClient,
    studioId: delivery.studio_id,
    template: message.providerTemplateKey,
    eventId: delivery.id,
    recipient: delivery.recipient_snapshot.phone,
    variables: delivery.template_variables,
  });

  if (result.status === "accepted") {
    return {
      status: "accepted",
      providerKey: "meta_whatsapp",
      providerMessageId: result.providerMessageId,
      httpStatus: result.httpStatus,
      response: result.responseSnapshot,
    };
  }

  if (result.status === "skipped") {
    return {
      status: "skipped",
      providerKey: "meta_whatsapp",
      errorCode: result.errorCode,
      httpStatus: result.httpStatus ?? null,
      response: result.responseSnapshot ?? {},
    };
  }

  return {
    status: result.retryable ? "retry" : "failed",
    providerKey: "meta_whatsapp",
    errorCode: result.errorCode,
    httpStatus: result.httpStatus ?? null,
    response: result.responseSnapshot ?? {},
  };
}

async function sendEmail(): Promise<AdapterResult> {
  return {
    status: "skipped",
    providerKey: "email",
    errorCode: "email_provider_not_configured",
    errorMessage: "No email provider is configured for Studio Flow yet.",
    response: {},
  };
}

async function runAdapter(
  adminClient: SupabaseClient,
  delivery: DeliveryRow,
  message: RenderedMessage,
): Promise<AdapterResult> {
  if (!delivery.adapter_enabled) {
    return {
      status: "skipped",
      providerKey: delivery.provider_key ?? delivery.adapter_key,
      errorCode: "notification_adapter_disabled",
      response: { adapter_key: delivery.adapter_key },
    };
  }

  switch (delivery.adapter_key) {
    case "studio_flow_inbox":
      return sendInbox(adminClient, delivery, message);
    case "web_push":
      return sendPush(adminClient, delivery, message);
    case "asistian":
      return sendWhatsAppAsistian(adminClient, delivery, message);
    case "meta_whatsapp":
      return sendWhatsAppMeta(adminClient, delivery, message);
    case "email_provider":
      return sendEmail();
    default:
      return {
        status: "failed",
        providerKey: delivery.provider_key ?? delivery.adapter_key,
        errorCode: "notification_adapter_unsupported",
        response: { adapter_key: delivery.adapter_key },
      };
  }
}

async function handoffJobs(adminClient: SupabaseClient, workerId: string, batchSize: number) {
  const { data: claims, error: claimError } = await adminClient.rpc(
    "system_claim_notification_jobs",
    {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: 120,
    },
  );

  if (claimError) throw new Error("notification_handoff_claim_failed");

  const claimed = (Array.isArray(claims) ? claims : []) as ClaimedJob[];
  const results = [];

  for (const claim of claimed) {
    try {
      const { data, error } = await adminClient.rpc("system_accept_notification_delivery_handoff", {
        p_job_id: claim.job_id,
        p_worker_id: workerId,
      });

      if (error) throw new Error(error.message);

      const result = Array.isArray(data) ? data[0] : data;
      results.push({
        ok: true,
        jobId: claim.job_id,
        deliveryId: result?.delivery_id ?? null,
        created: result?.created === true,
      });
    } catch (error) {
      const safeError = error instanceof Error ? error.message.slice(0, 1000) : "unknown_error";

      await adminClient.rpc("system_fail_notification_job_handoff", {
        p_job_id: claim.job_id,
        p_worker_id: workerId,
        p_error_code: "notification_delivery_handoff_failed",
        p_error_safe: safeError,
        p_retry_after_seconds: 60,
      });

      results.push({
        ok: false,
        jobId: claim.job_id,
        error: safeError,
      });
    }
  }

  return { claimed: claimed.length, results };
}

async function processDelivery(
  adminClient: SupabaseClient,
  claim: ClaimedDelivery,
  workerId: string,
) {
  let attemptId: string | null = null;

  try {
    const delivery = await resolveDeliveryAdapter(
      adminClient,
      await loadDelivery(adminClient, claim.delivery_id),
    );

    const { data: startedAttempt, error: attemptError } = await adminClient.rpc(
      "system_start_notification_delivery_attempt",
      {
        p_delivery_id: delivery.id,
        p_worker_id: workerId,
        p_provider_key: delivery.provider_key ?? delivery.adapter_key,
      },
    );

    if (attemptError || !startedAttempt) {
      throw new Error("notification_delivery_attempt_start_failed");
    }

    attemptId = String(startedAttempt);

    const message = renderMessage(delivery);

    const { data: snapshotSaved, error: snapshotError } = await adminClient.rpc(
      "system_set_notification_delivery_message_snapshot",
      {
        p_delivery_id: delivery.id,
        p_worker_id: workerId,
        p_message_snapshot: {
          title: message.title,
          body: message.body,
          url: message.url,
          tag: message.tag,
          provider_template_key: message.providerTemplateKey,
        },
      },
    );

    if (snapshotError || snapshotSaved !== true) {
      throw new Error("notification_delivery_message_snapshot_failed");
    }

    let result: AdapterResult;
    if (
      delivery.recipient_type === "student" &&
      delivery.recipient_entity_id &&
      ["push", "whatsapp", "email"].includes(delivery.channel_key)
    ) {
      const { data: allowed, error: preferenceError } = await adminClient.rpc(
        "service_notification_channel_allowed",
        {
          p_studio_id: delivery.studio_id,
          p_recipient_type: delivery.recipient_type,
          p_recipient_entity_id: delivery.recipient_entity_id,
          p_channel_key: delivery.channel_key,
        },
      );

      if (preferenceError) {
        throw new Error("notification_channel_preference_lookup_failed");
      }

      if (allowed !== true) {
        result = {
          status: "skipped",
          providerKey: delivery.provider_key ?? delivery.adapter_key,
          errorCode: "recipient_channel_disabled",
          response: { preference: "disabled" },
        };
      } else {
        result = await runAdapter(adminClient, delivery, message);
      }
    } else {
      result = await runAdapter(adminClient, delivery, message);
    }

    if (result.status === "delivered") {
      const { data, error } = await adminClient.rpc(
        "system_mark_notification_delivery_attempt_delivered",
        {
          p_attempt_id: attemptId,
          p_provider_message_id: result.providerMessageId ?? null,
          p_http_status: result.httpStatus ?? null,
          p_response_snapshot: result.response,
        },
      );

      if (error || data !== true) throw new Error("notification_delivery_mark_delivered_failed");
    } else if (result.status === "accepted") {
      const { data, error } = await adminClient.rpc(
        "system_mark_notification_delivery_attempt_accepted",
        {
          p_attempt_id: attemptId,
          p_provider_message_id: result.providerMessageId ?? null,
          p_http_status: result.httpStatus ?? null,
          p_response_snapshot: result.response,
        },
      );

      if (error || data !== true) throw new Error("notification_delivery_mark_accepted_failed");
    } else if (result.status === "skipped") {
      const { data, error } = await adminClient.rpc(
        "system_mark_notification_delivery_attempt_skipped",
        {
          p_attempt_id: attemptId,
          p_reason_code: result.errorCode,
          p_reason_safe: result.errorMessage ?? null,
          p_response_snapshot: result.response,
        },
      );

      if (error || data !== true) throw new Error("notification_delivery_mark_skipped_failed");
    } else {
      const { data, error } = await adminClient.rpc(
        "system_mark_notification_delivery_attempt_failed",
        {
          p_attempt_id: attemptId,
          p_retryable: result.status === "retry",
          p_error_category: "provider",
          p_error_code: result.errorCode,
          p_error_message_safe: result.errorMessage ?? null,
          p_http_status: result.httpStatus ?? null,
          p_response_snapshot: result.response,
          p_retry_after_seconds: 60,
        },
      );

      if (error || data !== true) throw new Error("notification_delivery_mark_failed_failed");
    }

    return {
      ok: true,
      deliveryId: delivery.id,
      channel: delivery.channel_key,
      outcome: result.status,
    };
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 1000) : "unknown_error";

    if (attemptId) {
      const retryable = !safeError.startsWith("notification_template_unsupported:");

      await adminClient.rpc("system_mark_notification_delivery_attempt_failed", {
        p_attempt_id: attemptId,
        p_retryable: retryable,
        p_error_category: retryable ? "worker" : "configuration",
        p_error_code: retryable
          ? "notification_delivery_worker_exception"
          : "notification_template_unsupported",
        p_error_message_safe: safeError,
        p_http_status: null,
        p_response_snapshot: {},
        p_retry_after_seconds: 60,
      });
    }

    return {
      ok: false,
      deliveryId: claim.delivery_id,
      channel: claim.channel_key,
      error: safeError,
    };
  }
}

async function deliver(adminClient: SupabaseClient, workerId: string, batchSize: number) {
  const { data: claims, error: claimError } = await adminClient.rpc(
    "system_claim_notification_deliveries",
    {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: 120,
    },
  );

  if (claimError) throw new Error("notification_delivery_claim_failed");

  const claimed = (Array.isArray(claims) ? claims : []) as ClaimedDelivery[];
  const results = [];

  for (const claim of claimed) {
    results.push(await processDelivery(adminClient, claim, workerId));
  }

  return { claimed: claimed.length, results };
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

    try {
      const handoff = await handoffJobs(adminClient, workerId, batchSize);
      const deliveries = await deliver(adminClient, workerId, batchSize);

      return response({
        ok: true,
        workerId,
        handoffClaimed: handoff.claimed,
        handoffSucceeded: handoff.results.filter((item) => item.ok).length,
        deliveryClaimed: deliveries.claimed,
        deliverySucceeded: deliveries.results.filter((item) => item.ok).length,
        handoffResults: handoff.results,
        deliveryResults: deliveries.results,
      });
    } catch (error) {
      return response(
        {
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 1000) : "unknown_error",
        },
        500,
      );
    }
  }),
};

export default handler;
