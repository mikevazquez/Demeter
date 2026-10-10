import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  downloadMetaWhatsAppMedia,
  type MetaWhatsAppWebhookConfig,
  type MetaDownloadedMedia,
} from "./meta-whatsapp-channel";
import { readTransferReceipt, rejectedTransferReceiptReply } from "./receipt-reader";

export async function handleDemiEnrollmentReceipt(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  eventId: string;
  providerMessageId: string;
  mediaId: string | null;
  messageType: string;
  webhookConfig?: MetaWhatsAppWebhookConfig;
  downloadedMedia?: MetaDownloadedMedia;
}) {
  if (!input.mediaId || !["image", "document"].includes(input.messageType))
    return { handled: false as const };
  const pending = await input.supabase
    .from("assistant_enrollment_intents")
    .select("id,amount_minor,currency")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("payment_method", "bank_transfer")
    .in("status", ["receipt_required", "human_review", "rejected"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending.error) throw new Error("enrollment_receipt_lookup_failed");
  if (!pending.data) return { handled: false as const };
  const media =
    input.downloadedMedia ??
    (input.webhookConfig
      ? await downloadMetaWhatsAppMedia({ config: input.webhookConfig, mediaId: input.mediaId })
      : null);
  if (!media) throw new Error("enrollment_receipt_media_unavailable");
  const hash = createHash("sha256").update(media.bytes).digest("hex");
  const path = `${input.studioId}/enrollment/${pending.data.id}/${hash}`;
  const stored = await input.supabase.storage
    .from("transfer-receipts")
    .upload(path, media.bytes, { contentType: media.mimeType, upsert: false });
  if (stored.error && !/already exists|duplicate/i.test(stored.error.message))
    throw new Error("enrollment_receipt_storage_failed");
  let reading: Awaited<ReturnType<typeof readTransferReceipt>> | null = null;
  try {
    reading = await readTransferReceipt({ bytes: media.bytes, mimeType: media.mimeType });
  } catch {
    /* Keep unreadable evidence. */
  }
  const rejectedReply = rejectedTransferReceiptReply(reading);
  if (rejectedReply)
    return {
      handled: true as const,
      reply: rejectedReply,
      result: { ok: false, reason_code: "receipt_not_payment_evidence" },
    };

  const recorded = await input.supabase.rpc("service_record_demi_enrollment_receipt", {
    p_studio: input.studioId,
    p_conversation: input.conversationId,
    p_intent: pending.data.id,
    p_event: input.eventId,
    p_provider: input.providerMessageId,
    p_path: path,
    p_hash: hash,
    p_amount: reading?.amountMinor ?? null,
    p_currency: reading?.currency ?? null,
    p_confidence: reading?.confidence ?? 0,
  });
  if (recorded.error) throw new Error("enrollment_receipt_record_failed");
  const result = recorded.data;
  const reply =
    result?.ok && result.status === "human_review"
      ? `Recibí tu comprobante de inscripción. No activé la inscripción ni modifiqué tu paquete o créditos. ${result.human_review_created ? "El caso ya quedó con el equipo para validar el ingreso a Bancomer." : "Falta completar la revisión; todavía no puedo confirmar que el caso esté asignado al equipo."}`
      : result?.status === "approved"
        ? "Ese comprobante ya fue validado; no se registró otro pago."
        : result?.status === "received"
          ? "Ese comprobante ya quedó pendiente de revisión; no se activó la inscripción ni se duplicó el pago."
          : result?.status === "rejected"
            ? "Ese documento fue rechazado. Envía un comprobante nuevo y correcto; no se activará la inscripción hasta validar el pago."
            : result?.reason_code === "receipt_already_used"
              ? "Ese comprobante ya corresponde a otra solicitud de pago. No lo apliqué otra vez. Envía un documento nuevo que corresponda a esta inscripción."
              : result?.reason_code === "receipt_amount_mismatch"
                ? "El importe o moneda del comprobante no coincide con la inscripción. No activé derechos. Envía el documento correcto."
                : "No pude aceptar este comprobante de inscripción. Conservé el documento, sin activar derechos. Envía uno legible o solicita revisión del equipo.";
  return { handled: true as const, result, reply };
}
