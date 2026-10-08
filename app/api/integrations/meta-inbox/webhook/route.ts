import { nameFromExplicitReply } from "@/lib/assistant/meta-prospect-name";
import { runAssistantTurn } from "@/lib/assistant/orchestrator";
import { getStudentPackageStatus } from "@/lib/assistant/read-tools";
import {
  extractMetaInboxMessages,
  loadMetaInboxWebhookConfig,
  metaInboxSha256,
  sendMetaInboxText,
  verifyMetaInboxWebhookSignature,
  verifyMetaInboxWebhookToken,
  type MetaInboxProvider,
} from "@/lib/assistant/meta-inbox-channel";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(body: JsonObject, status = 200) {
  return Response.json(body, { status });
}

function studioIdFromRequest(request: Request) {
  const studioId = new URL(request.url).searchParams.get("studio")?.trim() ?? "";
  return UUID_RE.test(studioId) ? studioId : null;
}

function providerTimestamp(value: string | null) {
  if (!value || !/^\d{9,13}$/.test(value)) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const milliseconds = value.length <= 10 ? raw * 1000 : raw;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function markEvent(
  supabase: ReturnType<typeof createServiceClient>,
  studioId: string,
  eventId: string,
  patch: JsonObject,
) {
  await supabase
    .from("assistant_meta_inbox_events")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("studio_id", studioId);
}

async function captureEvent(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  provider: MetaInboxProvider;
  providerMessageId: string;
  providerAccountId: string;
  providerContactId: string;
  messageType: string;
  text: string;
  timestamp: string | null;
  rawBody: string;
}) {
  const row = {
    studio_id: input.studioId,
    provider: input.provider,
    provider_event_id: input.providerMessageId,
    provider_account_id: input.providerAccountId,
    provider_contact_id: input.providerContactId,
    message_type: input.messageType,
    body_preview: input.text.slice(0, 500),
    provider_timestamp: providerTimestamp(input.timestamp),
    payload_fingerprint: metaInboxSha256(
      `${input.rawBody}\nmessage:${input.providerMessageId}`,
    ),
    processing_status: "captured",
  };

  const { data, error } = await input.supabase
    .from("assistant_meta_inbox_events")
    .insert(row)
    .select(
      "id,processing_status,attempt_count,assistant_conversation_id,inbound_turn_id,outbound_turn_id",
    )
    .single();

  if (!error && data) return data;
  if (error?.code !== "23505") throw new Error("meta_inbox_event_capture_failed");

  const { data: existing, error: lookupError } = await input.supabase
    .from("assistant_meta_inbox_events")
    .select(
      "id,processing_status,attempt_count,assistant_conversation_id,inbound_turn_id,outbound_turn_id",
    )
    .eq("studio_id", input.studioId)
    .eq("provider", input.provider)
    .eq("provider_event_id", input.providerMessageId)
    .maybeSingle();

  if (lookupError || !existing) throw new Error("meta_inbox_event_lookup_failed");
  return existing;
}

async function loadRuntimeContext(
  supabase: ReturnType<typeof createServiceClient>,
  studioId: string,
) {
  const [{ data: studio, error: studioError }, { data: config, error: configError }] =
    await Promise.all([
      supabase.from("studios").select("id,name,timezone,currency").eq("id", studioId).maybeSingle(),
      supabase
        .from("assistant_configs")
        .select(
          "assistant_name,mode,model,reasoning_effort,personality_instructions,monthly_budget_usd_micros,conversation_budget_usd_micros,max_model_calls_per_turn,max_tool_calls_per_turn",
        )
        .eq("studio_id", studioId)
        .maybeSingle(),
    ]);

  if (studioError || !studio) throw new Error("studio_not_found");
  if (configError || !config) throw new Error("assistant_not_configured");
  return { studio, config };
}

async function hasBlockingOpenHandoff(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  conversationId: string;
}) {
  const { data, error } = await input.supabase
    .from("assistant_handoffs")
    .select("reason_code")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("status", "open");
  if (error) throw new Error("assistant_handoff_lookup_failed");

  const reasons = [...new Set((data ?? []).map((row) => String(row.reason_code ?? "")).filter(Boolean))];
  if (!reasons.length) return false;

  const { data: policies, error: policyError } = await input.supabase
    .from("assistant_handoff_policies")
    .select("reason_code,enabled,blocking")
    .eq("studio_id", input.studioId)
    .in("reason_code", reasons);
  if (policyError) throw new Error("assistant_handoff_policy_lookup_failed");

  const byReason = new Map((policies ?? []).map((row) => [row.reason_code, row]));
  return reasons.some((reason) => {
    const policy = byReason.get(reason);
    return !policy || (policy.enabled === true && policy.blocking === true);
  });
}

async function persistAcceptedReply(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  eventId: string;
  provider: MetaInboxProvider;
  conversationId: string;
  reply: string;
  recipientId: string;
  providerMessageId: string;
  httpStatus: number;
  responseSnapshot: JsonObject;
  trace?: unknown;
}) {
  const { data: outboundTurn, error: turnError } = await input.supabase
    .from("assistant_turns")
    .insert({
      studio_id: input.studioId,
      conversation_id: input.conversationId,
      direction: "outbound",
      role: "assistant",
      content: input.reply,
      sanitized: true,
      channel_message_ref: input.providerMessageId,
    })
    .select("id")
    .single();

  if (turnError || !outboundTurn) throw new Error("assistant_reply_persist_failed");

  await input.supabase.from("assistant_meta_inbox_deliveries").insert({
    studio_id: input.studioId,
    event_id: input.eventId,
    conversation_id: input.conversationId,
    turn_id: outboundTurn.id,
    provider: input.provider,
    recipient_id: input.recipientId,
    provider_message_id: input.providerMessageId,
    text_fingerprint: metaInboxSha256(input.reply),
    attempt_number: 1,
    status: "accepted",
    error_code: null,
    http_status: input.httpStatus,
    response_snapshot: input.responseSnapshot,
  });

  await input.supabase
    .from("assistant_conversations")
    .update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("studio_id", input.studioId);

  await markEvent(input.supabase, input.studioId, input.eventId, {
    processing_status: "processed",
    outbound_turn_id: outboundTurn.id,
    processing_result: {
      outcome: "replied",
      provider_message_id: input.providerMessageId,
      trace: input.trace ?? null,
    },
    last_error_code: null,
    processed_at: new Date().toISOString(),
  });
}

async function recordFailedDelivery(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  eventId: string;
  provider: MetaInboxProvider;
  conversationId: string;
  recipientId: string;
  reply: string;
  errorCode: string;
  retryable: boolean;
  httpStatus?: number;
  responseSnapshot: JsonObject;
}) {
  const { count } = await input.supabase
    .from("assistant_meta_inbox_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", input.studioId)
    .eq("event_id", input.eventId);

  await input.supabase.from("assistant_meta_inbox_deliveries").insert({
    studio_id: input.studioId,
    event_id: input.eventId,
    conversation_id: input.conversationId,
    turn_id: null,
    provider: input.provider,
    recipient_id: input.recipientId,
    provider_message_id: null,
    text_fingerprint: metaInboxSha256(input.reply),
    attempt_number: (count ?? 0) + 1,
    status: "error",
    error_code: input.errorCode,
    http_status: input.httpStatus ?? null,
    response_snapshot: input.responseSnapshot,
  });

  await markEvent(input.supabase, input.studioId, input.eventId, {
    processing_status: "error",
    processing_result: { outcome: "delivery_failed", retryable: input.retryable },
    last_error_code: input.errorCode,
  });
}

export async function GET(request: Request) {
  const studioId = studioIdFromRequest(request);
  if (!studioId) return new Response("invalid_studio", { status: 400 });

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return new Response("receiver_not_configured", { status: 503 });
  }

  let config;
  try {
    config = await loadMetaInboxWebhookConfig(supabase, studioId);
  } catch {
    return new Response("receiver_not_configured", { status: 503 });
  }
  if (!config) return new Response("receiver_not_configured", { status: 503 });

  const url = new URL(request.url);
  // Operational probe for DNS/TLS validation. Never bypass Meta's challenge
  // check for requests containing webhook verification parameters.
  if (
    url.searchParams.get("health") === "meta-inbox" &&
    !url.searchParams.has("hub.mode") &&
    !url.searchParams.has("hub.verify_token") &&
    !url.searchParams.has("hub.challenge")
  ) {
    return new Response("meta-inbox-ready", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    !challenge ||
    !verifyMetaInboxWebhookToken(config.verifyToken, token)
  ) {
    return new Response("forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  // Operational diagnostics contain only delivery stages and counts, never message bodies,
  // sender identifiers, access tokens, or signature values.
  console.info("[demi-meta-inbox] incoming_post");
  const studioId = studioIdFromRequest(request);
  if (!studioId) {
    console.warn("[demi-meta-inbox] invalid_studio");
    return json({ error: "invalid_studio" }, 400);
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return json({ error: "receiver_not_configured" }, 503);
  }

  const rawBytes = Buffer.from(await request.arrayBuffer());
  const rawBody = rawBytes.toString("utf8");
  let webhookConfig;
  try {
    webhookConfig = await loadMetaInboxWebhookConfig(supabase, studioId);
  } catch {
    return json({ error: "receiver_not_configured" }, 503);
  }
  if (!webhookConfig) {
    console.warn("[demi-meta-inbox] missing_webhook_config");
    return json({ error: "receiver_not_configured" }, 503);
  }

  if (
    !verifyMetaInboxWebhookSignature(
      webhookConfig.appSecret,
      rawBytes,
      request.headers.get("x-hub-signature-256"),
    )
  ) {
    console.warn("[demi-meta-inbox] invalid_signature", { has_signature_header: request.headers.has("x-hub-signature-256"), valid_signature_header_format: /^sha256=[0-9a-f]{64}$/i.test(request.headers.get("x-hub-signature-256")?.trim() ?? "") });
    return json({ error: "invalid_signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const messages = extractMetaInboxMessages(body);
  console.info("[demi-meta-inbox] signature_valid", {
    message_count: messages.length,
    object_type: typeof (body as { object?: unknown })?.object === "string"
      ? (body as { object: string }).object.slice(0, 24)
      : "unknown",
  });
  if (!messages.length) return json({ ok: true, accepted: true, messages: 0 });

  let runtimeContext;
  try {
    runtimeContext = await loadRuntimeContext(supabase, studioId);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "assistant_runtime_unavailable" },
      503,
    );
  }

  const liveMode = String(runtimeContext.config.mode ?? "");
  const sendReplies = liveMode === "pilot" || liveMode === "active";
  const runAssistant = sendReplies || liveMode === "shadow";
  console.info("[demi-meta-inbox] runtime_mode", { mode: liveMode, message_count: messages.length });
  let retryableFailure = false;
  const outcomes: JsonObject[] = [];

  // Demo/off acknowledges Meta without storing customer content.
  if (!runAssistant) {
    return json({
      ok: true,
      accepted: true,
      messages: messages.length,
      outcomes: messages.map((message) => ({
        provider_message_id: message.providerMessageId,
        outcome: "assistant_mode_not_live",
        mode: liveMode,
      })),
    });
  }

  for (const message of messages) {
    if (!["text", "postback"].includes(message.messageType) || !message.text.trim()) {
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "unsupported_message_type",
      });
      continue;
    }

    const expectedAccountId =
      message.provider === "instagram"
        ? webhookConfig.instagramUserId
        : webhookConfig.pageId;
    if (message.providerAccountId !== expectedAccountId) {
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "provider_account_mismatch",
      });
      continue;
    }

    if (
      liveMode === "pilot" &&
      !webhookConfig.pilotContactIds[message.provider].includes(message.providerContactId)
    ) {
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "pilot_contact_not_allowed",
      });
      continue;
    }

    let event;
    try {
      event = await captureEvent({
        supabase,
        studioId,
        provider: message.provider,
        providerMessageId: message.providerMessageId,
        providerAccountId: message.providerAccountId,
        providerContactId: message.providerContactId,
        messageType: message.messageType,
        text: message.text,
        timestamp: message.timestamp,
        rawBody,
      });
    } catch {
      retryableFailure = true;
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "capture_failed",
      });
      continue;
    }

    if (["processed", "ignored", "human_review"].includes(event.processing_status)) {
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "duplicate_already_handled",
      });
      continue;
    }
    if (event.processing_status === "processing") {
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "duplicate_in_progress",
      });
      continue;
    }

    await markEvent(supabase, studioId, event.id, {
      processing_status: "processing",
      attempt_count: Number(event.attempt_count ?? 0) + 1,
      last_error_code: null,
    });

    const { data: preparedData, error: preparedError } = await supabase.rpc(
      "service_prepare_meta_inbox_message",
      {
        target_studio_id: studioId,
        target_event_id: event.id,
        target_provider: message.provider,
        target_provider_account_id: message.providerAccountId,
        target_provider_message_id: message.providerMessageId,
        target_provider_contact_id: message.providerContactId,
        target_display_name: message.displayName,
        target_message_type: message.messageType,
        target_message_text: message.text,
        target_activity_at: providerTimestamp(message.timestamp) ?? new Date().toISOString(),
      },
    );

    const prepared = isObject(preparedData) ? preparedData : null;
    if (preparedError || !prepared || prepared.ok !== true) {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: { outcome: "prepare_failed" },
        last_error_code: "meta_inbox_message_prepare_failed",
      });
      continue;
    }

    const conversationId = String(prepared.assistant_conversation_id ?? "").trim();
    const inboundTurnId = String(prepared.inbound_turn_id ?? "").trim();
    const studentId = String(prepared.student_id ?? "").trim() || null;
    const crmContactId = String(prepared.crm_contact_id ?? "").trim() || null;
    let identityNeedsName = prepared.identity_needs_name === true;

    if (!conversationId || !inboundTurnId) {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: { outcome: "identity_incomplete" },
        last_error_code: "assistant_identity_incomplete",
      });
      continue;
    }

    if (prepared.handoff_open === true) {
      let blockingHandoff = true;
      try {
        blockingHandoff = await hasBlockingOpenHandoff({ supabase, studioId, conversationId });
      } catch {
        retryableFailure = true;
        await markEvent(supabase, studioId, event.id, {
          processing_status: "error",
          processing_result: { outcome: "handoff_lookup_failed" },
          last_error_code: "assistant_handoff_lookup_failed",
        });
        continue;
      }
      if (blockingHandoff) {
        await markEvent(supabase, studioId, event.id, {
          processing_status: "human_review",
          processing_result: { outcome: "human_takeover_active" },
          processed_at: new Date().toISOString(),
        });
        outcomes.push({
          provider_message_id: message.providerMessageId,
          outcome: "human_takeover_active",
        });
        continue;
      }
    }

    const { data: recentTurns, error: historyError } = await supabase
      .from("assistant_turns")
      .select("role,content,created_at")
      .eq("studio_id", studioId)
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(12);

    if (historyError) {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: { outcome: "history_failed" },
        last_error_code: "conversation_history_failed",
      });
      continue;
    }

    const history = (recentTurns ?? [])
      .slice()
      .reverse()
      .map((item) => ({
        role: item.role as "user" | "assistant",
        content: item.content,
      }));

    // Record a full name only after the prospect explicitly answers Demi's
    // request. Never use a typed name to link or authenticate existing students.
    if (!studentId && crmContactId) {
      const { data: identity } = await supabase
        .from("assistant_channel_identities")
        .select("id,person_id,student_id,metadata")
        .eq("studio_id", studioId)
        .eq("provider", message.provider)
        .eq("provider_account_id", message.providerAccountId)
        .eq("provider_contact_id", message.providerContactId)
        .eq("crm_contact_id", crmContactId)
        .maybeSingle();

      if (identity && !identity.student_id) {
        const metadata = isObject(identity.metadata) ? identity.metadata : {};
        if (metadata.name_confirmed === true) {
          identityNeedsName = false;
        } else if (identity.person_id) {
          const confirmedName = nameFromExplicitReply(history);
          if (confirmedName) {
            const parts = confirmedName.split(" ");
            const { error: personError } = await supabase
              .from("persons")
              .update({ first_name: parts[0], last_name: parts.slice(1).join(" ") })
              .eq("id", identity.person_id)
              .eq("studio_id", studioId);
            if (!personError) {
              const { error: identityError } = await supabase
                .from("assistant_channel_identities")
                .update({
                  display_name: confirmedName,
                  metadata: { ...metadata, name_confirmed: true },
                })
                .eq("id", identity.id)
                .eq("studio_id", studioId)
                .is("student_id", null);
              if (!identityError) identityNeedsName = false;
            }
          }
        }
      }
    }

    let studentCategory: string | null = null;
    if (studentId) {
      try {
        const studentStatus = await getStudentPackageStatus({
          supabase,
          studio: {
            id: runtimeContext.studio.id,
            name: runtimeContext.studio.name,
            timezone: runtimeContext.studio.timezone,
            currency: runtimeContext.studio.currency,
          },
          studentId,
        });
        if (studentStatus.ok === true && isObject(studentStatus.student_state)) {
          studentCategory = String(studentStatus.student_state.category ?? "") || null;
        }
      } catch {
        studentCategory = null;
      }
    }

    let assistantResult;
    try {
      assistantResult = await runAssistantTurn({
        supabase,
        studio: {
          id: runtimeContext.studio.id,
          name: runtimeContext.studio.name,
          timezone: runtimeContext.studio.timezone,
          currency: runtimeContext.studio.currency,
        },
        config: {
          assistant_name: runtimeContext.config.assistant_name,
          model: runtimeContext.config.model,
          reasoning_effort: runtimeContext.config.reasoning_effort as
            "none" | "low" | "medium" | "high",
          personality_instructions: runtimeContext.config.personality_instructions,
          monthly_budget_usd_micros: runtimeContext.config.monthly_budget_usd_micros,
          conversation_budget_usd_micros: runtimeContext.config.conversation_budget_usd_micros,
          max_model_calls_per_turn: runtimeContext.config.max_model_calls_per_turn,
          max_tool_calls_per_turn: runtimeContext.config.max_tool_calls_per_turn,
        },
        conversationId,
        turnId: inboundTurnId,
        studentId,
        studentCategory,
        crmContactId,
        identityNeedsName,
        channel: message.channel,
        activationUrl: null,
        serviceMode: true,
        history,
      });
    } catch (error) {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: { outcome: "assistant_failed" },
        last_error_code: error instanceof Error ? error.message : "assistant_failed",
      });
      continue;
    }

    if (!sendReplies) {
      await markEvent(supabase, studioId, event.id, {
        processing_status: "processed",
        processing_result: { outcome: "shadow_completed", trace: assistantResult.trace },
        processed_at: new Date().toISOString(),
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "shadow_completed",
      });
      continue;
    }

    const delivery = await sendMetaInboxText({
      config: webhookConfig,
      provider: message.provider,
      recipientId: message.providerContactId,
      text: assistantResult.reply,
    });

    if (delivery.status === "error") {
      await recordFailedDelivery({
        supabase,
        studioId,
        eventId: event.id,
        provider: message.provider,
        conversationId,
        recipientId: message.providerContactId,
        reply: assistantResult.reply,
        errorCode: delivery.errorCode,
        retryable: delivery.retryable,
        httpStatus: delivery.httpStatus,
        responseSnapshot: delivery.responseSnapshot,
      });
      retryableFailure = retryableFailure || delivery.retryable;
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "delivery_failed",
        retryable: delivery.retryable,
      });
      continue;
    }

    try {
      await persistAcceptedReply({
        supabase,
        studioId,
        eventId: event.id,
        provider: message.provider,
        conversationId,
        reply: assistantResult.reply,
        recipientId: message.providerContactId,
        providerMessageId: delivery.providerMessageId,
        httpStatus: delivery.httpStatus,
        responseSnapshot: delivery.responseSnapshot,
        trace: assistantResult.trace,
      });
    } catch {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: { outcome: "reply_persist_failed_after_send" },
        last_error_code: "reply_persist_failed_after_send",
      });
      continue;
    }

    outcomes.push({
      provider_message_id: message.providerMessageId,
      outcome: "replied",
    });
  }

  return json(
    { ok: !retryableFailure, accepted: true, messages: messages.length, outcomes },
    retryableFailure ? 500 : 200,
  );
}
