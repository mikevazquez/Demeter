"use server";

import { createHash, randomUUID } from "node:crypto";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createServiceClient } from "@/lib/supabase/service";
import { readTransferReceipt } from "@/lib/assistant/receipt-reader";

const RECEIPT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function sendDemiReceipt(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const requestedStudentId = String(formData.get("studentId") ?? "").trim();
  const file = formData.get("file");

  if (!conversationId || !requestedStudentId) {
    return { ok: false as const, error: "receipt_identity_required" };
  }

  if (!(file instanceof File) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return { ok: false as const, error: "receipt_invalid_file" };
  }

  if (!RECEIPT_MIME_TYPES.has(file.type)) {
    return { ok: false as const, error: "receipt_invalid_file" };
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: config } = await supabase
    .from("assistant_configs")
    .select("mode")
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!config) {
    return { ok: false as const, error: "assistant_not_configured" };
  }

  if (config.mode !== "demo") {
    return { ok: false as const, error: "assistant_demo_disabled" };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("assistant_conversations")
    .select("id,student_id")
    .eq("id", conversationId)
    .eq("studio_id", studio.id)
    .eq("channel", "internal_demo")
    .eq("status", "open")
    .maybeSingle();

  if (conversationError || !conversation) {
    return { ok: false as const, error: "conversation_not_found" };
  }

  if (!conversation.student_id || conversation.student_id !== requestedStudentId) {
    return { ok: false as const, error: "conversation_identity_mismatch" };
  }

  const service = createServiceClient();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { data: pendingIntent, error: pendingError } = await service
    .from("assistant_transfer_purchase_intents")
    .select("id,amount_minor,currency,intent_kind,status,expires_at")
    .eq("studio_id", studio.id)
    .eq("conversation_id", conversationId)
    .eq("student_id", requestedStudentId)
    .eq("status", "awaiting_receipt")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pendingIntent) {
    return { ok: false as const, error: "receipt_no_pending_transfer" };
  }

  const reading = await readTransferReceipt({ bytes, mimeType: file.type });
  const expectedAmount = Number(pendingIntent.amount_minor);
  const expectedCurrency = String(pendingIntent.currency ?? "MXN").toUpperCase();
  const amountMatches =
    reading.amountMinor != null &&
    reading.confidence >= 0.75 &&
    reading.amountMinor === expectedAmount &&
    (!reading.currency || reading.currency === expectedCurrency);

  const { error: readingError } = await service
    .from("assistant_transfer_purchase_intents")
    .update({
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
    .eq("studio_id", studio.id);

  if (readingError) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  if (!amountMatches) {
    const expected = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: expectedCurrency,
    }).format(expectedAmount / 100);
    const detected =
      reading.amountMinor == null
        ? null
        : new Intl.NumberFormat("es-MX", {
            style: "currency",
            currency: expectedCurrency,
          }).format(reading.amountMinor / 100);
    const subject = pendingIntent.intent_kind === "trial_class" ? "primera clase" : "paquete";
    const reply = detected
      ? `Recibí tu comprobante, pero el monto que pude leer (${detected}) no coincide con tu ${subject} pendiente (${expected}). No confirmé nada.`
      : `Recibí tu comprobante, pero no pude leer el monto con suficiente seguridad. No confirmé tu ${subject}; el pago sigue pendiente.`;

    await service.from("assistant_turns").insert([
      {
        studio_id: studio.id,
        conversation_id: conversationId,
        direction: "inbound",
        role: "user",
        content: `[Comprobante adjunto: ${file.name}]`,
        sanitized: true,
      },
      {
        studio_id: studio.id,
        conversation_id: conversationId,
        direction: "outbound",
        role: "assistant",
        content: reply,
        sanitized: true,
      },
    ]);

    return {
      ok: true as const,
      conversationId,
      reply,
      packageName: subject,
      status: "receipt_mismatch",
    };
  }

  const providerMessageId = `internal-demo-receipt-${randomUUID()}`;
  const mediaId = `internal-demo-media-${randomUUID()}`;
  const messageType = file.type === "application/pdf" ? "document" : "image";
  const payloadFingerprint = createHash("sha256")
    .update(`${providerMessageId}:${file.name}:${file.size}:${file.type}`)
    .digest("hex");

  const { data: event, error: eventError } = await service
    .from("assistant_whatsapp_events")
    .insert({
      studio_id: studio.id,
      provider: "meta_whatsapp",
      provider_event_id: providerMessageId,
      phone_number_id: "internal_demo",
      contact_wa_id: `internal_demo:${requestedStudentId}`,
      message_type: messageType,
      body_preview: "",
      media_id: mediaId,
      payload_fingerprint: payloadFingerprint,
      processing_status: "captured",
    })
    .select("id")
    .single();

  if (eventError || !event) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const activationRequest =
    pendingIntent.intent_kind === "trial_class"
      ? await service.rpc("service_activate_trial_transfer_receipt", {
          target_studio_id: studio.id,
          target_conversation_id: conversationId,
          target_student_id: requestedStudentId,
          target_intent_id: pendingIntent.id,
          target_event_id: event.id,
          target_provider_message_id: providerMessageId,
          target_media_id: mediaId,
        })
      : await service.rpc("service_activate_transfer_receipt", {
          target_studio_id: studio.id,
          target_conversation_id: conversationId,
          target_student_id: requestedStudentId,
          target_event_id: event.id,
          target_provider_message_id: providerMessageId,
          target_media_id: mediaId,
        });

  const activation = asObject(activationRequest.data);
  if (activationRequest.error || !activation || activation.ok !== true) {
    const reason = String(activation?.reason_code ?? "");
    return {
      ok: false as const,
      error:
        reason === "pending_transfer_not_found" || reason === "transfer_intent_expired"
          ? "receipt_no_pending_transfer"
          : "receipt_activation_failed",
    };
  }

  const intentId = String(activation.intent_id ?? "").trim();
  if (!intentId) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const extension =
    file.type === "application/pdf"
      ? "pdf"
      : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
  const storagePath = `${studio.id}/${requestedStudentId}/${intentId}/receipt.${extension}`;

  const { error: storageError } = await service.storage
    .from("transfer-receipts")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });

  if (storageError) {
    return { ok: false as const, error: "receipt_upload_failed" };
  }

  const { error: metadataError } = await service
    .from("assistant_transfer_purchase_intents")
    .update({
      receipt_storage_path: storagePath,
      receipt_mime_type: file.type,
      receipt_file_size: file.size,
      receipt_stored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("studio_id", studio.id)
    .eq("student_id", requestedStudentId);

  if (metadataError) {
    return { ok: false as const, error: "receipt_upload_failed" };
  }

  const isTrialPayment = pendingIntent.intent_kind === "trial_class";
  const packageName = isTrialPayment
    ? String(activation.activity ?? "tu primera clase").trim() || "tu primera clase"
    : String(activation.package_name ?? "tu paquete").trim() || "tu paquete";
  const saleId = String(activation.sale_id ?? "").trim();

  const { data: handoffData, error: handoffError } = await service.rpc("assistant_create_handoff", {
    target_studio_id: studio.id,
    target_conversation_id: conversationId,
    target_student_id: requestedStudentId,
    target_reason_code: "transfer_receipt_review",
    target_note: isTrialPayment
      ? `Comprobante recibido en UAT. Primera clase confirmada provisionalmente: ${packageName}. Intento: ${intentId}. Venta: ${saleId || "sin referencia"}. Validar transferencia.`
      : `Comprobante recibido en UAT. Paquete activado provisionalmente: ${packageName}. Intento: ${intentId}. Venta: ${saleId || "sin referencia"}. Validar transferencia.`,
  });

  if (handoffError || asObject(handoffData)?.ok !== true) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const userTurn = `[Comprobante adjunto: ${file.name}]`;
  const reply = isTrialPayment
    ? `Recibí tu comprobante y el monto coincide. Tu primera clase de ${packageName} quedó confirmada. La transferencia queda pendiente de validación.`
    : `Recibí tu comprobante. Activé provisionalmente ${packageName} para que puedas continuar. El pago queda pendiente de validación. Si al revisar la transferencia no se confirma correctamente, el paquete puede ser revocado.`;

  await service.from("assistant_turns").insert([
    {
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "inbound",
      role: "user",
      content: userTurn,
      sanitized: true,
    },
    {
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      content: reply,
      sanitized: true,
    },
  ]);

  await service
    .from("assistant_conversations")
    .update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("studio_id", studio.id);

  return {
    ok: true as const,
    conversationId,
    reply,
    packageName,
    status: String(activation.status ?? "provisional_active"),
  };
}
