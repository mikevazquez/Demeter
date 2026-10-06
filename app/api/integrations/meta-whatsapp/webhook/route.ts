import { runAssistantTurn } from "@/lib/assistant/orchestrator";
import { getStudentPackageStatus } from "@/lib/assistant/read-tools";
import {
  downloadMetaWhatsAppMedia,
  extractMetaInboundMessages,
  loadMetaWhatsAppWebhookConfig,
  sendMetaWhatsAppText,
  sha256Hex,
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
  type MetaWhatsAppWebhookConfig,
} from "@/lib/assistant/meta-whatsapp-channel";
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

function redactSensitiveReply(value: string) {
  return value.replace(
    /https:\/\/[^\s]+\/login\/student\/activar\?[^\s]+/g,
    "[enlace de activación enviado]",
  );
}

async function markEvent(
  supabase: ReturnType<typeof createServiceClient>,
  studioId: string,
  eventId: string,
  patch: JsonObject,
) {
  await supabase
    .from("assistant_whatsapp_events")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("studio_id", studioId);
}

async function captureEvent(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  providerMessageId: string;
  phoneNumberId: string;
  fromWaId: string;
  messageType: string;
  text: string;
  mediaId: string | null;
  timestamp: string | null;
  rawBody: string;
}) {
  const row = {
    studio_id: input.studioId,
    provider: "meta_whatsapp",
    provider_event_id: input.providerMessageId,
    phone_number_id: input.phoneNumberId,
    contact_wa_id: input.fromWaId,
    message_type: input.messageType,
    body_preview: input.text.slice(0, 500),
    media_id: input.mediaId,
    provider_timestamp: providerTimestamp(input.timestamp),
    payload_fingerprint: sha256Hex(`${input.rawBody}\nmessage:${input.providerMessageId}`),
    processing_status: "captured",
  };

  const { data, error } = await input.supabase
    .from("assistant_whatsapp_events")
    .insert(row)
    .select(
      "id,processing_status,attempt_count,assistant_conversation_id,inbound_turn_id,outbound_turn_id",
    )
    .single();

  if (!error && data) return data;

  if (error?.code !== "23505") {
    throw new Error("meta_event_capture_failed");
  }

  const { data: existing, error: lookupError } = await input.supabase
    .from("assistant_whatsapp_events")
    .select(
      "id,processing_status,attempt_count,assistant_conversation_id,inbound_turn_id,outbound_turn_id",
    )
    .eq("studio_id", input.studioId)
    .eq("provider", "meta_whatsapp")
    .eq("provider_event_id", input.providerMessageId)
    .maybeSingle();

  if (lookupError || !existing) {
    throw new Error("meta_event_lookup_failed");
  }

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

  if (error) {
    throw new Error("assistant_handoff_lookup_failed");
  }

  return (data ?? []).some((handoff) => handoff.reason_code !== "transfer_receipt_review");
}

async function createMediaHandoff(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  conversationId: string;
  studentId: string | null;
  messageType: string;
  providerMessageId: string;
}) {
  const { data, error } = await input.supabase.rpc("assistant_create_handoff", {
    target_studio_id: input.studioId,
    target_conversation_id: input.conversationId,
    target_student_id: input.studentId,
    target_reason_code: "whatsapp_media_review",
    target_note:
      `Se recibió un mensaje de tipo ${input.messageType} en WhatsApp. ` +
      `Referencia Meta: ${input.providerMessageId}`,
  });

  return !error && isObject(data) && data.ok === true;
}

async function activateTransferReceiptIfPending(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  conversationId: string;
  studentId: string | null;
  eventId: string;
  providerMessageId: string;
  mediaId: string | null;
  messageType: string;
  webhookConfig: MetaWhatsAppWebhookConfig;
}) {
  if (!input.studentId || !input.mediaId || !["image", "document"].includes(input.messageType)) {
    return { handled: false as const };
  }

  const { data, error } = await input.supabase.rpc("service_activate_transfer_receipt", {
    target_studio_id: input.studioId,
    target_conversation_id: input.conversationId,
    target_student_id: input.studentId,
    target_event_id: input.eventId,
    target_provider_message_id: input.providerMessageId,
    target_media_id: input.mediaId,
  });

  const result = isObject(data) ? data : null;
  if (error) {
    throw new Error("transfer_receipt_activation_failed");
  }

  if (!result || result.ok !== true) {
    if (
      result?.reason_code === "pending_transfer_not_found" ||
      result?.reason_code === "transfer_intent_expired"
    ) {
      return { handled: false as const };
    }
    return {
      handled: false as const,
      reasonCode: String(result?.reason_code ?? "transfer_receipt_not_activated"),
    };
  }

  const packageName = String(result.package_name ?? "tu paquete").trim() || "tu paquete";
  const intentId = String(result.intent_id ?? "").trim();
  const saleId = String(result.sale_id ?? "").trim();

  if (!UUID_RE.test(intentId)) {
    throw new Error("transfer_receipt_intent_missing");
  }

  const media = await downloadMetaWhatsAppMedia({
    config: input.webhookConfig,
    mediaId: input.mediaId,
  });

  const extension =
    media.mimeType === "application/pdf"
      ? "pdf"
      : media.mimeType === "image/png"
        ? "png"
        : media.mimeType === "image/webp"
          ? "webp"
          : "jpg";
  const storagePath = `${input.studioId}/${input.studentId}/${intentId}/receipt.${extension}`;

  const { error: storageError } = await input.supabase.storage
    .from("transfer-receipts")
    .upload(storagePath, media.bytes, {
      contentType: media.mimeType,
      upsert: true,
      cacheControl: "3600",
    });

  if (storageError) {
    throw new Error("transfer_receipt_storage_failed");
  }

  const { error: receiptUpdateError } = await input.supabase
    .from("assistant_transfer_purchase_intents")
    .update({
      receipt_storage_path: storagePath,
      receipt_mime_type: media.mimeType,
      receipt_file_size: media.fileSize,
      receipt_stored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("studio_id", input.studioId)
    .eq("student_id", input.studentId);

  if (receiptUpdateError) {
    throw new Error("transfer_receipt_storage_metadata_failed");
  }

  const { data: handoffData, error: handoffError } = await input.supabase.rpc(
    "assistant_create_handoff",
    {
      target_studio_id: input.studioId,
      target_conversation_id: input.conversationId,
      target_student_id: input.studentId,
      target_reason_code: "transfer_receipt_review",
      target_note:
        `Comprobante recibido. Paquete activado provisionalmente: ${packageName}. ` +
        `Intento: ${intentId || "sin referencia"}. Venta: ${saleId || "sin referencia"}. ` +
        `Validar la transferencia; si falla, revocar el paquete provisional.`,
    },
  );

  if (handoffError || !isObject(handoffData) || handoffData.ok !== true) {
    throw new Error("transfer_receipt_handoff_failed");
  }

  return {
    handled: true as const,
    result,
    reply:
      `Recibí tu comprobante. Activé provisionalmente ${packageName} para que puedas continuar. ` +
      "El pago queda pendiente de validación. Si al revisar la transferencia no se confirma correctamente, el paquete puede ser revocado.",
  };
}

async function persistAcceptedReply(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  eventId: string;
  conversationId: string;
  inboundTurnId: string;
  reply: string;
  recipientWaId: string;
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
      content: redactSensitiveReply(input.reply),
      sanitized: true,
      channel_message_ref: input.providerMessageId,
    })
    .select("id")
    .single();

  if (turnError || !outboundTurn) {
    throw new Error("assistant_reply_persist_failed");
  }

  await input.supabase.from("assistant_whatsapp_deliveries").insert({
    studio_id: input.studioId,
    event_id: input.eventId,
    conversation_id: input.conversationId,
    turn_id: outboundTurn.id,
    recipient_wa_id: input.recipientWaId,
    provider_message_id: input.providerMessageId,
    text_fingerprint: sha256Hex(input.reply),
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
  conversationId: string;
  recipientWaId: string;
  reply: string;
  errorCode: string;
  retryable: boolean;
  httpStatus?: number;
  responseSnapshot: JsonObject;
}) {
  const { count } = await input.supabase
    .from("assistant_whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", input.studioId)
    .eq("event_id", input.eventId);

  await input.supabase.from("assistant_whatsapp_deliveries").insert({
    studio_id: input.studioId,
    event_id: input.eventId,
    conversation_id: input.conversationId,
    turn_id: null,
    recipient_wa_id: input.recipientWaId,
    provider_message_id: null,
    text_fingerprint: sha256Hex(input.reply),
    attempt_number: (count ?? 0) + 1,
    status: "error",
    error_code: input.errorCode,
    http_status: input.httpStatus ?? null,
    response_snapshot: input.responseSnapshot,
  });

  await markEvent(input.supabase, input.studioId, input.eventId, {
    processing_status: "error",
    processing_result: {
      outcome: "delivery_failed",
      retryable: input.retryable,
    },
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
    config = await loadMetaWhatsAppWebhookConfig(supabase, studioId);
  } catch {
    return new Response("receiver_not_configured", { status: 503 });
  }
  if (!config) return new Response("receiver_not_configured", { status: 503 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !challenge || !verifyMetaWebhookToken(config.verifyToken, token)) {
    return new Response("forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const studioId = studioIdFromRequest(request);
  if (!studioId) return json({ error: "invalid_studio" }, 400);

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return json({ error: "receiver_not_configured" }, 503);
  }

  const rawBody = await request.text();

  let webhookConfig;
  try {
    webhookConfig = await loadMetaWhatsAppWebhookConfig(supabase, studioId);
  } catch {
    return json({ error: "receiver_not_configured" }, 503);
  }
  if (!webhookConfig) {
    return json({ error: "receiver_not_configured" }, 503);
  }

  if (
    !verifyMetaWebhookSignature(
      webhookConfig.appSecret,
      rawBody,
      request.headers.get("x-hub-signature-256"),
    )
  ) {
    return json({ error: "invalid_signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const messages = extractMetaInboundMessages(body);
  if (!messages.length) {
    console.info("demi_meta_webhook", {
      stage: "parsed",
      outcome: "no_messages",
    });
    return json({ ok: true, accepted: true, messages: 0 });
  }

  console.info("demi_meta_webhook", {
    stage: "parsed",
    message_count: messages.length,
  });

  let runtimeContext;
  try {
    runtimeContext = await loadRuntimeContext(supabase, studioId);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "assistant_runtime_unavailable",
      },
      503,
    );
  }

  const liveMode = String(runtimeContext.config.mode ?? "");
  const sendReplies = liveMode === "pilot" || liveMode === "active";
  const runAssistant = sendReplies || liveMode === "shadow";
  let retryableFailure = false;
  const outcomes: JsonObject[] = [];

  // While Demi is off/demo, acknowledge Meta without persisting customer content.
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
    const rawWaId = message.fromWaId.replace(/\D/g, "");
    const canonicalWaId = /^521[0-9]{10}$/.test(rawWaId) ? `52${rawWaId.slice(3)}` : rawWaId;
    const pilotContactAllowed =
      liveMode === "pilot" && webhookConfig.pilotWaIds.includes(canonicalWaId);

    if (liveMode === "pilot" && !pilotContactAllowed) {
      console.info("demi_meta_webhook", {
        stage: "pre_capture",
        outcome: "pilot_contact_not_allowed",
        pilot_allowlist_count: webhookConfig.pilotWaIds.length,
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "pilot_contact_not_allowed",
      });
      continue;
    }

    if (pilotContactAllowed) {
      console.info("demi_meta_webhook", {
        stage: "pre_capture",
        outcome: "pilot_contact_allowed",
      });
    }

    if (message.phoneNumberId !== webhookConfig.phoneNumberId) {
      console.info("demi_meta_webhook", {
        stage: "pre_capture",
        outcome: "phone_number_mismatch",
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "phone_number_mismatch",
      });
      continue;
    }

    if (message.wabaId && message.wabaId !== webhookConfig.wabaId) {
      console.info("demi_meta_webhook", {
        stage: "pre_capture",
        outcome: "waba_mismatch",
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "waba_mismatch",
      });
      continue;
    }

    let event;
    try {
      event = await captureEvent({
        supabase,
        studioId,
        providerMessageId: message.providerMessageId,
        phoneNumberId: message.phoneNumberId,
        fromWaId: message.fromWaId,
        messageType: message.messageType,
        text: message.text,
        mediaId: message.mediaId,
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
      "service_prepare_meta_whatsapp_message",
      {
        target_studio_id: studioId,
        target_event_id: event.id,
        target_provider_message_id: message.providerMessageId,
        target_wa_id: message.fromWaId,
        target_profile_name: message.profileName,
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
        last_error_code: "meta_message_prepare_failed",
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "prepare_failed",
      });
      continue;
    }

    const conversationId = String(prepared.assistant_conversation_id ?? "").trim();
    const inboundTurnId = String(prepared.inbound_turn_id ?? "").trim();
    const studentId = String(prepared.student_id ?? "").trim() || null;
    const crmContactId = String(prepared.crm_contact_id ?? "").trim() || null;
    const identityNeedsName = prepared.identity_needs_name === true;

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
        blockingHandoff = await hasBlockingOpenHandoff({
          supabase,
          studioId,
          conversationId,
        });
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

      console.info("demi_meta_webhook", {
        stage: "handoff",
        outcome: "non_blocking_transfer_review",
      });
    }

    if (message.mediaId || !["text", "button", "interactive"].includes(message.messageType)) {
      let transferReceipt: Awaited<ReturnType<typeof activateTransferReceiptIfPending>> | null =
        null;

      try {
        transferReceipt = await activateTransferReceiptIfPending({
          supabase,
          studioId,
          conversationId,
          studentId,
          eventId: event.id,
          providerMessageId: message.providerMessageId,
          mediaId: message.mediaId,
          messageType: message.messageType,
          webhookConfig,
        });
      } catch {
        retryableFailure = true;
        await markEvent(supabase, studioId, event.id, {
          processing_status: "error",
          processing_result: { outcome: "transfer_receipt_activation_failed" },
          last_error_code: "transfer_receipt_activation_failed",
        });
        continue;
      }

      let reply: string;
      let deterministicOutcome: string;

      if (transferReceipt?.handled) {
        reply = transferReceipt.reply;
        deterministicOutcome = "transfer_receipt_provisional";
      } else {
        const handedOff = await createMediaHandoff({
          supabase,
          studioId,
          conversationId,
          studentId,
          messageType: message.messageType,
          providerMessageId: message.providerMessageId,
        });

        if (!handedOff) {
          retryableFailure = true;
          await markEvent(supabase, studioId, event.id, {
            processing_status: "error",
            processing_result: { outcome: "media_handoff_failed" },
            last_error_code: "media_handoff_failed",
          });
          continue;
        }

        reply = "Recibí tu archivo. Lo pasé a revisión humana dentro de este mismo chat.";
        deterministicOutcome = "media_handoff";
      }

      if (sendReplies) {
        const delivery = await sendMetaWhatsAppText({
          config: webhookConfig,
          recipientWaId: message.fromWaId,
          text: reply,
        });

        if (delivery.status === "error") {
          await recordFailedDelivery({
            supabase,
            studioId,
            eventId: event.id,
            conversationId,
            recipientWaId: message.fromWaId,
            reply,
            errorCode: delivery.errorCode,
            retryable: delivery.retryable,
            httpStatus: delivery.httpStatus,
            responseSnapshot: delivery.responseSnapshot,
          });
          retryableFailure = retryableFailure || delivery.retryable;
          continue;
        }

        await persistAcceptedReply({
          supabase,
          studioId,
          eventId: event.id,
          conversationId,
          inboundTurnId,
          reply,
          recipientWaId: message.fromWaId,
          providerMessageId: delivery.providerMessageId,
          httpStatus: delivery.httpStatus,
          responseSnapshot: delivery.responseSnapshot,
          trace: { deterministic: deterministicOutcome },
        });
      } else {
        await markEvent(supabase, studioId, event.id, {
          processing_status: "human_review",
          processing_result: {
            outcome: "media_handoff_shadow",
          },
          processed_at: new Date().toISOString(),
        });
      }

      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: deterministicOutcome,
      });
      continue;
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
          const category = String(studentStatus.student_state.category ?? "");
          if (
            [
              "trial_pending",
              "trial_attended",
              "trial_cancelled",
              "trial_no_show",
              "former_student",
              "student",
            ].includes(category)
          ) {
            studentCategory = category;
          }
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
        activationUrl: new URL("/login/student/activar", request.url).toString(),
        serviceMode: true,
        history,
      });
    } catch (error) {
      retryableFailure = true;
      await markEvent(supabase, studioId, event.id, {
        processing_status: "error",
        processing_result: {
          outcome: "assistant_failed",
        },
        last_error_code: error instanceof Error ? error.message : "assistant_failed",
      });
      continue;
    }

    if (!sendReplies) {
      await markEvent(supabase, studioId, event.id, {
        processing_status: "processed",
        processing_result: {
          outcome: "shadow_completed",
          trace: assistantResult.trace,
        },
        processed_at: new Date().toISOString(),
      });
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: "shadow_completed",
      });
      continue;
    }

    const delivery = await sendMetaWhatsAppText({
      config: webhookConfig,
      recipientWaId: message.fromWaId,
      text: assistantResult.reply,
    });

    if (delivery.status === "error") {
      await recordFailedDelivery({
        supabase,
        studioId,
        eventId: event.id,
        conversationId,
        recipientWaId: message.fromWaId,
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
        conversationId,
        inboundTurnId,
        reply: assistantResult.reply,
        recipientWaId: message.fromWaId,
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
    {
      ok: !retryableFailure,
      accepted: true,
      messages: messages.length,
      outcomes,
    },
    retryableFailure ? 500 : 200,
  );
}
