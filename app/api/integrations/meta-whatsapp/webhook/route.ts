import { runAssistantTurn } from "@/lib/assistant/orchestrator";
import { loadDemiRuntimeConfig } from "@/lib/assistant/runtime-config";
import { getStudentPackageStatus } from "@/lib/assistant/read-tools";
import { readTransferReceipt } from "@/lib/assistant/receipt-reader";
import { provisionStudentAccessWithServiceClient } from "@/lib/assistant/student-access";
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
import {
  extractMetaDeliveryStatuses,
  persistMetaDeliveryStatuses,
} from "@/lib/assistant/meta-delivery-status";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_MEDIA_MESSAGE_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

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
      loadDemiRuntimeConfig(supabase, studioId),
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

  const reasonCodes = [
    ...new Set((data ?? []).map((handoff) => String(handoff.reason_code ?? "")).filter(Boolean)),
  ];
  if (!reasonCodes.length) return false;
  const { data: policies, error: policyError } = await input.supabase
    .from("assistant_handoff_policies")
    .select("reason_code,enabled,blocking")
    .eq("studio_id", input.studioId)
    .in("reason_code", reasonCodes);
  if (policyError) throw new Error("assistant_handoff_policy_lookup_failed");
  const byReason = new Map((policies ?? []).map((row) => [row.reason_code, row]));
  return reasonCodes.some((reason) => {
    const policy = byReason.get(reason);
    // Legacy review reasons stay non-blocking. Unknown legacy handoffs remain blocking for safety.
    if (!policy) return !["transfer_receipt_review", "whatsapp_media_review"].includes(reason);
    return policy.enabled === true && policy.blocking === true;
  });
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

function normalizeReceiptText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9$., ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReceiptMoney(amountMinor: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

function matchReceiptPackageOption(
  message: string,
  rawOptions: unknown,
  allowSingleConfirmation = false,
) {
  if (!Array.isArray(rawOptions)) return null;
  const options = rawOptions
    .map((item) => (isObject(item) ? item : null))
    .filter((item): item is JsonObject => Boolean(item));
  if (!options.length) return null;

  const normalized = normalizeReceiptText(message);
  if (!normalized) return null;

  if (
    allowSingleConfirmation &&
    options.length === 1 &&
    ["si", "sí", "confirmo", "adelante", "dale", "va", "ok", "correcto"].includes(
      message.trim().toLocaleLowerCase("es-MX"),
    )
  ) {
    return options[0];
  }

  const optionNumber = normalized.match(/^([1-9][0-9]?)$/);
  if (optionNumber) {
    const selected = options.find((item) => Number(item.option_number) === Number(optionNumber[1]));
    if (selected) return selected;
  }

  const classMatch = normalized.match(/\b(\d{1,3})\s*(?:clase|clases)\b/);
  if (classMatch) {
    const credits = Number(classMatch[1]);
    const matches = options.filter(
      (item) => item.unlimited !== true && Number(item.credit_limit) === credits,
    );
    if (matches.length === 1) return matches[0];
  }

  if (normalized.includes("ilimitado")) {
    const matches = options.filter((item) => item.unlimited === true);
    if (matches.length === 1) return matches[0];
  }

  const nameMatches = options.filter((item) => {
    const name = normalizeReceiptText(String(item.name ?? ""));
    return Boolean(name) && (normalized === name || normalized.includes(name));
  });
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

async function createReceiptValidationHandoff(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  conversationId: string;
  studentId: string;
  note: string;
}) {
  const { data: policy } = await input.supabase
    .from("assistant_handoff_policies")
    .select("enabled")
    .eq("studio_id", input.studioId)
    .eq("reason_code", "receipt_validation_failed")
    .maybeSingle();
  if (policy?.enabled !== true) return;

  await input.supabase.rpc("assistant_create_handoff", {
    target_studio_id: input.studioId,
    target_conversation_id: input.conversationId,
    target_student_id: input.studentId,
    target_reason_code: "receipt_validation_failed",
    target_note: input.note,
  });
}

async function tryResolveReceiptPackageChoice(input: {
  supabase: ReturnType<typeof createServiceClient>;
  studioId: string;
  conversationId: string;
  studentId: string | null;
  messageText: string;
}) {
  if (!input.studentId) return null;

  const { data: pending, error } = await input.supabase
    .from("assistant_pending_actions")
    .select("id,action_payload,expires_at")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("action_type", "commerce.transfer_package_choice")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !pending) return null;
  const payload = isObject(pending.action_payload) ? pending.action_payload : null;
  if (!payload || String(payload.stage ?? "") !== "receipt_package_choice") return null;
  const options = Array.isArray(payload.options) ? payload.options : [];
  const selected = matchReceiptPackageOption(input.messageText, options, true);

  if (!selected) {
    const labels = options
      .map((item) => (isObject(item) ? String(item.name ?? "").trim() : ""))
      .filter(Boolean);
    return {
      reply:
        labels.length > 1
          ? `Para aplicar ese comprobante necesito saber a qué paquete corresponde. Puedes decirme: ${labels.join(", ")}.`
          : "Para aplicar ese comprobante necesito que me confirmes si corresponde al paquete que te indiqué.",
      outcome: "receipt_package_choice_waiting",
    };
  }

  const productTemplateId = String(selected.product_template_id ?? "").trim();
  const eventId = String(payload.event_id ?? "").trim();
  const providerMessageId = String(payload.provider_message_id ?? "").trim();
  const mediaId = String(payload.media_id ?? "").trim();
  if (
    !UUID_RE.test(productTemplateId) ||
    !UUID_RE.test(eventId) ||
    !providerMessageId ||
    !mediaId
  ) {
    return {
      reply: "No pude recuperar de forma segura ese comprobante. No activé ningún paquete.",
      outcome: "receipt_context_invalid",
    };
  }

  const { data: preparedData, error: preparedError } = await input.supabase.rpc(
    "service_prepare_transfer_purchase",
    {
      target_studio_id: input.studioId,
      target_conversation_id: input.conversationId,
      target_student_id: input.studentId,
      target_session_id: null,
      target_product_template_id: productTemplateId,
    },
  );
  const prepared = isObject(preparedData) ? preparedData : null;
  if (preparedError || !prepared || prepared.ok !== true) {
    return {
      reply: "No pude preparar ese paquete con seguridad. No hice ningún cambio.",
      outcome: "receipt_package_prepare_failed",
    };
  }

  const intentId = String(prepared.intent_id ?? "").trim();
  if (!UUID_RE.test(intentId)) {
    return {
      reply: "No pude preparar ese paquete con seguridad. No hice ningún cambio.",
      outcome: "receipt_package_prepare_failed",
    };
  }

  await input.supabase
    .from("assistant_transfer_purchase_intents")
    .update({
      receipt_event_id: eventId,
      receipt_provider_message_id: providerMessageId,
      receipt_media_id: mediaId,
      receipt_storage_path: payload.storage_path ?? null,
      receipt_mime_type: payload.mime_type ?? null,
      receipt_file_size: payload.file_size ?? null,
      receipt_stored_at: payload.stored_at ?? new Date().toISOString(),
      receipt_detected_amount_minor: payload.detected_amount_minor ?? null,
      receipt_detected_currency: payload.detected_currency ?? null,
      receipt_detected_date: payload.detected_date ?? null,
      receipt_detected_reference: payload.detected_reference ?? null,
      receipt_detected_bank: payload.detected_bank ?? null,
      receipt_read_confidence: payload.read_confidence ?? null,
      receipt_amount_matches: true,
      receipt_read_at: payload.read_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("studio_id", input.studioId);

  const { data: activationData, error: activationError } = await input.supabase.rpc(
    "service_activate_transfer_receipt",
    {
      target_studio_id: input.studioId,
      target_conversation_id: input.conversationId,
      target_student_id: input.studentId,
      target_event_id: eventId,
      target_provider_message_id: providerMessageId,
      target_media_id: mediaId,
    },
  );
  const activation = isObject(activationData) ? activationData : null;
  if (activationError || !activation || activation.ok !== true) {
    return {
      reply: "No pude activar el paquete con ese comprobante. No hice ningún cambio definitivo.",
      outcome: "receipt_package_activation_failed",
    };
  }

  await input.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      execution_ref: `transfer-intent:${intentId}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pending.id)
    .eq("studio_id", input.studioId)
    .eq("status", "pending");

  const packageName = String(activation.package_name ?? selected.name ?? "tu paquete");
  await createReceiptValidationHandoff({
    supabase: input.supabase,
    studioId: input.studioId,
    conversationId: input.conversationId,
    studentId: input.studentId,
    note: `Comprobante leído y asociado por monto a ${packageName}. Paquete activado provisionalmente; validar que la transferencia haya ingresado antes de aprobar definitivamente.`,
  });

  return {
    reply: `Listo. El comprobante corresponde a ${packageName} y el monto coincide. Activé el paquete provisionalmente; el pago queda pendiente de validación.`,
    outcome: "receipt_package_confirmed",
  };
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
  messageText: string;
  webhookConfig: MetaWhatsAppWebhookConfig;
  activationUrl: string;
}) {
  if (!input.studentId || !input.mediaId || !["image", "document"].includes(input.messageType)) {
    return { handled: false as const };
  }

  const { data: pendingIntent, error: pendingError } = await input.supabase
    .from("assistant_transfer_purchase_intents")
    .select("id,amount_minor,currency,status,expires_at,intent_kind")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("student_id", input.studentId)
    .eq("status", "awaiting_receipt")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw new Error("transfer_intent_lookup_failed");

  const media = await downloadMetaWhatsAppMedia({
    config: input.webhookConfig,
    mediaId: input.mediaId,
  });
  let reading: Awaited<ReturnType<typeof readTransferReceipt>> | null = null;
  try {
    reading = await readTransferReceipt({ bytes: media.bytes, mimeType: media.mimeType });
  } catch {
    reading = null;
  }

  const extension =
    media.mimeType === "application/pdf"
      ? "pdf"
      : media.mimeType === "image/png"
        ? "png"
        : media.mimeType === "image/webp"
          ? "webp"
          : "jpg";
  const provisionalKey = pendingIntent?.id ?? sha256Hex(input.providerMessageId).slice(0, 24);
  const storagePath = `${input.studioId}/${input.studentId}/${provisionalKey}/receipt.${extension}`;
  const { error: storageError } = await input.supabase.storage
    .from("transfer-receipts")
    .upload(storagePath, media.bytes, {
      contentType: media.mimeType,
      upsert: true,
      cacheControl: "3600",
    });
  if (storageError) throw new Error("transfer_receipt_storage_failed");

  if (!reading || reading.amountMinor == null || reading.confidence < 0.75) {
    await createReceiptValidationHandoff({
      supabase: input.supabase,
      studioId: input.studioId,
      conversationId: input.conversationId,
      studentId: input.studentId,
      note:
        pendingIntent?.intent_kind === "trial_class"
          ? "No se pudo leer el monto del comprobante de primera clase con suficiente confianza. Revisar el archivo antes de confirmar la reserva."
          : "No se pudo leer el monto del comprobante con suficiente confianza. Revisar el archivo antes de activar cualquier paquete.",
    });
    return {
      handled: true as const,
      result: { ok: false, reason_code: "receipt_amount_unreadable" },
      reply:
        pendingIntent?.intent_kind === "trial_class"
          ? "Recibí tu comprobante, pero no pude leer el monto con suficiente seguridad. No confirmé tu primera clase y el pago quedó pendiente de revisión."
          : "Recibí tu comprobante, pero no pude leer el monto con suficiente seguridad. No activé ningún paquete y el pago quedó pendiente de revisión.",
    };
  }

  if (pendingIntent) {
    const expectedAmount = Number(pendingIntent.amount_minor);
    const expectedCurrency = String(pendingIntent.currency ?? "MXN").toUpperCase();
    const isTrialPayment =
      String(pendingIntent.intent_kind ?? "product_purchase") === "trial_class";
    const paymentSubject = isTrialPayment ? "primera clase" : "paquete";
    const amountMatches =
      reading.amountMinor === expectedAmount &&
      (!reading.currency || reading.currency === expectedCurrency);

    const { error: readingPersistError } = await input.supabase
      .from("assistant_transfer_purchase_intents")
      .update({
        receipt_storage_path: storagePath,
        receipt_mime_type: media.mimeType,
        receipt_file_size: media.fileSize,
        receipt_stored_at: new Date().toISOString(),
        receipt_detected_amount_minor: reading.amountMinor,
        receipt_detected_currency: reading.currency,
        receipt_detected_date: reading.date,
        receipt_detected_reference: reading.reference,
        receipt_detected_bank: reading.bank,
        receipt_read_confidence: reading.confidence,
        receipt_amount_matches: amountMatches,
        receipt_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingIntent.id)
      .eq("studio_id", input.studioId);

    if (readingPersistError) throw new Error("transfer_receipt_reading_persist_failed");

    if (!amountMatches) {
      return {
        handled: true as const,
        result: { ok: false, reason_code: "receipt_amount_mismatch" },
        reply: `Recibí tu comprobante, pero el monto que pude leer (${formatReceiptMoney(reading.amountMinor, expectedCurrency)}) no coincide con tu ${paymentSubject} pendiente (${formatReceiptMoney(expectedAmount, expectedCurrency)}). No confirmé nada. Puedes enviarme el comprobante correcto.`,
      };
    }

    const activationRequest = isTrialPayment
      ? await input.supabase.rpc("service_activate_trial_transfer_receipt", {
          target_studio_id: input.studioId,
          target_conversation_id: input.conversationId,
          target_student_id: input.studentId,
          target_intent_id: pendingIntent.id,
          target_event_id: input.eventId,
          target_provider_message_id: input.providerMessageId,
          target_media_id: input.mediaId,
        })
      : await input.supabase.rpc("service_activate_transfer_receipt", {
          target_studio_id: input.studioId,
          target_conversation_id: input.conversationId,
          target_student_id: input.studentId,
          target_event_id: input.eventId,
          target_provider_message_id: input.providerMessageId,
          target_media_id: input.mediaId,
        });

    const result = isObject(activationRequest.data) ? activationRequest.data : null;
    if (activationRequest.error) throw new Error("transfer_receipt_activation_failed");

    if (!result || result.ok !== true) {
      const reasonCode = String(result?.reason_code ?? "transfer_receipt_not_activated");
      if (
        isTrialPayment &&
        [
          "session_full",
          "resource_full",
          "resource_unavailable",
          "resource_not_available",
        ].includes(reasonCode)
      ) {
        await createReceiptValidationHandoff({
          supabase: input.supabase,
          studioId: input.studioId,
          conversationId: input.conversationId,
          studentId: input.studentId,
          note: "El comprobante de primera clase coincide con el monto, pero el lugar dejó de estar disponible antes de confirmar la reserva. Resolver otra clase o devolución.",
        });

        return {
          handled: true as const,
          result: { ok: false, reason_code: reasonCode },
          reply:
            "Recibí tu comprobante y el monto coincide, pero ese lugar dejó de estar disponible antes de que pudiera confirmar la reserva. No hice una reserva incorrecta. Lo revisaremos por este mismo chat para ofrecerte otra clase o resolver el pago.",
        };
      }

      return { handled: false as const, reasonCode };
    }

    const label = isTrialPayment
      ? String(result.activity ?? "tu primera clase").trim() || "tu primera clase"
      : String(result.package_name ?? "tu paquete").trim() || "tu paquete";

    await createReceiptValidationHandoff({
      supabase: input.supabase,
      studioId: input.studioId,
      conversationId: input.conversationId,
      studentId: input.studentId,
      note: isTrialPayment
        ? `Comprobante leído: monto coincide con la primera clase ${label}. Reserva confirmada provisionalmente; validar que la transferencia haya ingresado antes de aprobar definitivamente.`
        : `Comprobante leído: monto coincide con ${label}. Paquete activado provisionalmente; validar que la transferencia haya ingresado antes de aprobar definitivamente.`,
    });

    let accessText = "";
    if (isTrialPayment) {
      const access = await provisionStudentAccessWithServiceClient({
        supabase: input.supabase,
        studioId: input.studioId,
        studentId: input.studentId,
        activationUrl: input.activationUrl,
        mode: "provision",
      });

      if (access.generated === true && access.activation_url) {
        accessText = ` Crea tu contraseña para entrar a la app aquí: ${access.activation_url}`;
      } else if (access.already_has_access === true) {
        accessText = " Tu acceso a la app ya está habilitado.";
      }
    }

    return {
      handled: true as const,
      result,
      reply: isTrialPayment
        ? `Recibí tu comprobante y el monto coincide. Tu primera clase de ${label} quedó confirmada. La transferencia queda pendiente de validación.${accessText}`
        : `Recibí tu comprobante y el monto coincide con ${label}. Activé tu paquete provisionalmente para que puedas continuar. El pago queda pendiente de validación.`,
    };
  }

  const expectedCurrency = reading.currency || "MXN";
  const { data: products, error: productError } = await input.supabase
    .from("product_templates")
    .select(
      "id,name,price_minor,currency,credit_limit,unlimited,package_term,product_type,assistant_visible,reward_credit_wallet",
    )
    .eq("studio_id", input.studioId)
    .eq("active", true)
    .eq("price_minor", reading.amountMinor)
    .neq("product_type", "enrollment");
  if (productError) throw new Error("receipt_package_lookup_failed");

  const candidates = (products ?? []).filter(
    (item) =>
      item.assistant_visible !== false &&
      item.reward_credit_wallet !== true &&
      (!reading.currency || String(item.currency ?? "").toUpperCase() === reading.currency),
  );

  if (!candidates.length) {
    return {
      handled: true as const,
      result: { ok: false, reason_code: "receipt_amount_without_package_match" },
      reply: `Gracias. Pude leer un pago de ${formatReceiptMoney(reading.amountMinor, expectedCurrency)}, pero no coincide exactamente con un paquete activo. ¿Qué estás pagando con esta transferencia?`,
    };
  }

  const { data: recentUserTurns } = await input.supabase
    .from("assistant_turns")
    .select("content")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(6);

  const context = normalizeReceiptText(
    [input.messageText, ...(recentUserTurns ?? []).map((row) => String(row.content ?? ""))].join(
      " ",
    ),
  );
  const scored = candidates.map((item) => {
    const name = normalizeReceiptText(String(item.name ?? ""));
    let score = name && context.includes(name) ? 5 : 0;
    if (item.unlimited === true && context.includes("ilimitado")) score = Math.max(score, 4);
    const credits = Number(item.credit_limit ?? 0);
    if (credits > 0 && new RegExp(`\\b${credits}\\s*(?:clase|clases)\\b`).test(context))
      score = Math.max(score, 4);
    const term = normalizeReceiptText(String(item.package_term ?? ""));
    if (term && context.includes(term)) score = Math.max(score, 3);
    return { item, score };
  });
  const bestScore = Math.max(...scored.map((row) => row.score));
  const strongMatches = scored.filter((row) => row.score === bestScore && row.score >= 3);

  if (strongMatches.length === 1) {
    const product = strongMatches[0].item;
    const { data: preparedData, error: preparedError } = await input.supabase.rpc(
      "service_prepare_transfer_purchase",
      {
        target_studio_id: input.studioId,
        target_conversation_id: input.conversationId,
        target_student_id: input.studentId,
        target_session_id: null,
        target_product_template_id: product.id,
      },
    );
    const prepared = isObject(preparedData) ? preparedData : null;
    if (preparedError || !prepared || prepared.ok !== true) {
      return {
        handled: true as const,
        result: { ok: false },
        reply:
          "Pude leer el comprobante, pero no pude preparar el paquete con seguridad. No activé nada.",
      };
    }
    const intentId = String(prepared.intent_id ?? "");
    await input.supabase
      .from("assistant_transfer_purchase_intents")
      .update({
        receipt_storage_path: storagePath,
        receipt_mime_type: media.mimeType,
        receipt_file_size: media.fileSize,
        receipt_stored_at: new Date().toISOString(),
        receipt_detected_amount_minor: reading.amountMinor,
        receipt_detected_currency: reading.currency,
        receipt_detected_date: reading.date,
        receipt_detected_reference: reading.reference,
        receipt_detected_bank: reading.bank,
        receipt_read_confidence: reading.confidence,
        receipt_amount_matches: true,
        receipt_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", intentId)
      .eq("studio_id", input.studioId);

    const { data: activationData, error: activationError } = await input.supabase.rpc(
      "service_activate_transfer_receipt",
      {
        target_studio_id: input.studioId,
        target_conversation_id: input.conversationId,
        target_student_id: input.studentId,
        target_event_id: input.eventId,
        target_provider_message_id: input.providerMessageId,
        target_media_id: input.mediaId,
      },
    );
    const activation = isObject(activationData) ? activationData : null;
    if (activationError || !activation || activation.ok !== true) {
      return {
        handled: true as const,
        result: { ok: false },
        reply:
          "Pude identificar el paquete, pero no pude activarlo con seguridad. No hice ningún cambio definitivo.",
      };
    }
    const packageName = String(activation.package_name ?? product.name ?? "tu paquete");
    await createReceiptValidationHandoff({
      supabase: input.supabase,
      studioId: input.studioId,
      conversationId: input.conversationId,
      studentId: input.studentId,
      note: `Comprobante asociado por contexto y monto a ${packageName}. Paquete activado provisionalmente; validar transferencia.`,
    });
    return {
      handled: true as const,
      result: activation,
      reply: `Gracias. Leí un pago de ${formatReceiptMoney(reading.amountMinor, expectedCurrency)} y por el contexto corresponde a ${packageName}. Activé el paquete provisionalmente; el pago queda pendiente de validación.`,
    };
  }

  const options = candidates.map((item, index) => ({
    option_number: index + 1,
    product_template_id: item.id,
    name: item.name,
    price_minor: item.price_minor,
    currency: item.currency,
    credit_limit: item.credit_limit,
    unlimited: item.unlimited,
    package_term: item.package_term,
  }));
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  await input.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("action_type", "commerce.receipt_package_choice")
    .eq("status", "pending");

  await input.supabase.from("assistant_pending_actions").insert({
    studio_id: input.studioId,
    conversation_id: input.conversationId,
    action_type: "commerce.receipt_package_choice",
    action_token_hash: sha256Hex(`${input.providerMessageId}:${input.studentId}:receipt-choice`),
    action_payload: {
      options,
      event_id: input.eventId,
      provider_message_id: input.providerMessageId,
      media_id: input.mediaId,
      storage_path: storagePath,
      mime_type: media.mimeType,
      file_size: media.fileSize,
      stored_at: new Date().toISOString(),
      detected_amount_minor: reading.amountMinor,
      detected_currency: reading.currency,
      detected_date: reading.date,
      detected_reference: reading.reference,
      detected_bank: reading.bank,
      read_confidence: reading.confidence,
      read_at: new Date().toISOString(),
    },
    confirmation_summary: {
      amount_minor: reading.amountMinor,
      currency: expectedCurrency,
      options,
    },
    status: "pending",
    expires_at: expiresAt,
  });

  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      handled: true as const,
      result: { ok: true, status: "package_confirmation_required" },
      reply: `Gracias. Veo un pago de ${formatReceiptMoney(reading.amountMinor, expectedCurrency)}. Ese monto coincide con ${String(only.name)}. ¿Quieres que active ese paquete de forma provisional mientras validamos la transferencia?`,
    };
  }

  const optionLines = options.map((item) => `${item.option_number}. ${String(item.name)}`);
  return {
    handled: true as const,
    result: { ok: true, status: "package_choice_required" },
    reply:
      `Gracias. Veo un pago de ${formatReceiptMoney(reading.amountMinor, expectedCurrency)} y hay más de un paquete con ese monto. ¿A cuál corresponde?\n\n` +
      optionLines.join("\n"),
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

  // Meta sends outbound delivery receipts separately from inbound messages.
  // Process signed receipts even when Demi is paused or in shadow mode.
  const deliveryStatuses = extractMetaDeliveryStatuses(body);
  if (deliveryStatuses.length) {
    try {
      const result = await persistMetaDeliveryStatuses(
        supabase,
        studioId,
        deliveryStatuses,
        webhookConfig.phoneNumberId,
        webhookConfig.wabaId,
      );
      console.info("demi_meta_delivery_receipts", {
        received: deliveryStatuses.length,
        updated: result.updated,
        ignored: result.ignored,
      });
    } catch {
      // Let Meta retry without acknowledging a receipt that was not persisted.
      return json({ error: "delivery_receipt_persist_failed" }, 503);
    }
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

    if (message.messageType === "unsupported") {
      const isClickToWhatsApp =
        message.referralSourceType === "ad" || message.referralSourceType === "post";
      const referralCopy = `${message.referralHeadline ?? ""} ${message.referralBody ?? ""}`.trim();
      const isPoleReferral = /\bpole\b/i.test(referralCopy);
      const reply = isClickToWhatsApp
        ? isPoleReferral
          ? "¡Hola! 👋 Gracias por escribir a Demeter. Claro, te ayudo a agendar tu primera clase de Pole. Puedes empezar desde cero. ¿Qué día u horario te acomoda?"
          : "¡Hola! 👋 Gracias por escribir a Demeter. Claro, te ayudo a agendar tu primera clase. ¿Qué disciplina te interesa y qué día u horario te acomoda?"
        : "Recibí tu mensaje, pero WhatsApp no me entregó su contenido en un formato que pueda leer. ¿Me lo reenvías como texto? Así te ayudo enseguida.";
      const deterministicOutcome = isClickToWhatsApp
        ? "unsupported_ad_lead"
        : "unsupported_message";

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
          trace: {
            deterministic: deterministicOutcome,
            referral_source_type: message.referralSourceType,
            referral_source_id: message.referralSourceId,
          },
        });
      } else {
        await markEvent(supabase, studioId, event.id, {
          processing_status: "processed",
          processing_result: {
            outcome: deterministicOutcome,
            referral_source_type: message.referralSourceType,
            referral_source_id: message.referralSourceId,
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

    if (message.mediaId || META_MEDIA_MESSAGE_TYPES.has(message.messageType)) {
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
          messageText: message.text,
          webhookConfig,
          activationUrl: new URL("/login/student/activar", request.url).toString(),
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

        const caption = message.text.trim();
        const paymentLanguage =
          /\\b(pagu[eé]|pago|pagado|transfer(?:encia|í|i)|comprobante|dep[oó]sito|deposit[eé])\\b/i.test(
            caption,
          );

        reply = paymentLanguage
          ? "Recibí tu comprobante. No pude asociarlo automáticamente a una compra pendiente, así que lo dejé para validación del pago."
          : "Recibí tu archivo. Lo dejé para revisión.";

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

    const receiptChoice = await tryResolveReceiptPackageChoice({
      supabase,
      studioId,
      conversationId,
      studentId,
      messageText: message.text,
    });
    if (receiptChoice) {
      const reply = receiptChoice.reply;
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
          trace: { deterministic: receiptChoice.outcome },
        });
      } else {
        await markEvent(supabase, studioId, event.id, {
          processing_status: "processed",
          processing_result: { outcome: receiptChoice.outcome },
          processed_at: new Date().toISOString(),
        });
      }
      outcomes.push({
        provider_message_id: message.providerMessageId,
        outcome: receiptChoice.outcome,
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

    // Learn safely: a user correction becomes a reviewable proposal, never an automatic prompt change.
    const currentMessage = message.text.trim();
    const normalizedCorrection = currentMessage
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-MX");
    const correctionSignal =
      /\b(no,? eso no|eso no es|te equivocaste|esta mal|incorrecto|no es asi|quise decir|me explique mal)\b/.test(
        normalizedCorrection,
      );
    if (correctionSignal) {
      const previousAssistant =
        [...history].reverse().find((row) => row.role === "assistant")?.content ?? "";
      if (previousAssistant) {
        const { data: existingProposal } = await supabase
          .from("assistant_learning_proposals")
          .select("id")
          .eq("studio_id", studioId)
          .eq("conversation_id", conversationId)
          .eq("source_turn_id", inboundTurnId)
          .maybeSingle();
        if (!existingProposal) {
          await supabase.from("assistant_learning_proposals").insert({
            studio_id: studioId,
            conversation_id: conversationId,
            source_turn_id: inboundTurnId,
            category: "correction",
            title: "Corrección detectada en conversación",
            evidence: `Demi: ${previousAssistant.slice(0, 700)}\nPersona: ${currentMessage.slice(0, 700)}`,
            proposed_instruction: `Revisa esta corrección antes de incorporarla: cuando una situación equivalente ocurra, evita repetir la respuesta corregida y prioriza la información vigente de Studio Flow. Corrección de referencia: ${currentMessage.slice(0, 500)}`,
            status: "pending",
          });
        }
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
