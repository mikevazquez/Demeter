"use server";

import { createHash, randomUUID } from "node:crypto";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createServiceClient } from "@/lib/supabase/service";

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

  const { data: activationData, error: activationError } = await service.rpc(
    "service_activate_transfer_receipt",
    {
      target_studio_id: studio.id,
      target_conversation_id: conversationId,
      target_student_id: requestedStudentId,
      target_event_id: event.id,
      target_provider_message_id: providerMessageId,
      target_media_id: mediaId,
    },
  );

  const activation = asObject(activationData);
  if (activationError || !activation || activation.ok !== true) {
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
  const bytes = new Uint8Array(await file.arrayBuffer());

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

  const packageName = String(activation.package_name ?? "tu paquete").trim() || "tu paquete";
  const saleId = String(activation.sale_id ?? "").trim();

  const { data: handoffData, error: handoffError } = await service.rpc(
    "assistant_create_handoff",
    {
      target_studio_id: studio.id,
      target_conversation_id: conversationId,
      target_student_id: requestedStudentId,
      target_reason_code: "transfer_receipt_review",
      target_note:
        `Comprobante recibido en UAT. Paquete activado provisionalmente: ${packageName}. ` +
        `Intento: ${intentId}. Venta: ${saleId || "sin referencia"}. Validar transferencia.`,
    },
  );

  if (handoffError || asObject(handoffData)?.ok !== true) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const userTurn = `[Comprobante adjunto: ${file.name}]`;
  const reply =
    `Recibí tu comprobante. Activé provisionalmente ${packageName} para que puedas continuar. ` +
    "El pago queda pendiente de validación. Si al revisar la transferencia no se confirma correctamente, el paquete puede ser revocado.";

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
