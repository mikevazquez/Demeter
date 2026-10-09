import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  downloadMetaWhatsAppMedia,
  type MetaWhatsAppWebhookConfig,
  type MetaDownloadedMedia,
} from "./meta-whatsapp-channel";
import { readTransferReceipt } from "./receipt-reader";

export async function groupBookingAction(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  currentUserMessage?: string;
}) {
  if (input.tool === "prepare_group_booking") {
    const session = /^session:([0-9a-f-]{36})$/i.exec(String(input.args.session_ref ?? ""));
    if (!session) return { ok: false, reason_code: "invalid_session_ref" };
    const { data, error } = await input.supabase.rpc("service_prepare_demi_group", {
      p_studio: input.studioId,
      p_conversation: input.conversationId,
      p_session: session[1],
      p_count: input.args.participant_count,
      p_transfer_count: input.args.transfer_count,
    });
    if (error) return { ok: false, reason_code: "group_prepare_failed" };
    if (data?.ok && data.status === "awaiting_receipt") {
      const setting = await input.supabase
        .from("demi_mercadopago_settings")
        .select("enabled")
        .eq("studio_id", input.studioId)
        .maybeSingle();
      if (
        !setting.error &&
        setting.data?.enabled === true &&
        !/transferencia|bancomer|bbva|oxxo|dep[oó]sito/i.test(input.currentUserMessage ?? "")
      ) {
        const order = await input.supabase.functions.invoke("create-demi-mercadopago-order", {
          body: {
            studio_id: input.studioId,
            conversation_id: input.conversationId,
            group_id: data.group_id,
          },
        });
        if (order.error || order.data?.ok !== true)
          return { ok: false, reason_code: order.data?.error ?? "automatic_checkout_unavailable" };
        return {
          ...data,
          external_checkout: order.data.external_checkout,
          receipt_required: false,
          request_participant_data: false,
          payment_verified: false,
          provider_confirmation_required: true,
        };
      }
      const bank = await input.supabase
        .from("studio_bank_transfer_settings")
        .select("bank_name,account_holder,account_number,clabe,instructions")
        .eq("studio_id", input.studioId)
        .eq("enabled", true)
        .maybeSingle();
      if (bank.error || !bank.data)
        return { ok: false, reason_code: "transfer_details_unavailable" };
      return { ...data, transfer_details: bank.data, request_participant_data: false };
    }
    return data;
  }
  const conversation = await input.supabase
    .from("assistant_conversations")
    .select("channel")
    .eq("studio_id", input.studioId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversation.error || !conversation.data)
    return { ok: false, reason_code: "conversation_not_found" };
  const meta = ["facebook_messenger", "instagram"].includes(conversation.data.channel);
  const { data, error } = await input.supabase.rpc(
    meta ? "service_complete_demi_meta_group" : "service_complete_demi_group",
    {
      p_studio: input.studioId,
      p_conversation: input.conversationId,
      p_group: input.args.group_id,
      p_participants: input.args.participants,
    },
  );
  return error ? { ok: false, reason_code: "group_completion_failed" } : data;
}

export async function handleDemiGroupReceipt(input: {
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
  const lookup = await input.supabase
    .from("demi_group_bookings")
    .select("id,status,amount_minor,currency,participant_count,prospect_contact_id")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("status", "awaiting_receipt")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookup.error) throw new Error("group_receipt_lookup_failed");
  if (!lookup.data) return { handled: false as const };
  if (!input.downloadedMedia && !input.webhookConfig)
    throw new Error("group_receipt_media_missing");
  const media =
    input.downloadedMedia ??
    (await downloadMetaWhatsAppMedia({
      config: input.webhookConfig!,
      mediaId: input.mediaId,
    }));
  const digest = createHash("sha256").update(media.bytes).digest("hex");
  const path = `${input.studioId}/groups/${lookup.data.id}/${digest}`;
  const stored = await input.supabase.storage.from("transfer-receipts").upload(path, media.bytes, {
    contentType: media.mimeType,
    upsert: true,
  });
  if (stored.error) throw new Error("group_receipt_storage_failed");
  let reading: Awaited<ReturnType<typeof readTransferReceipt>> | null = null;
  try {
    reading = await readTransferReceipt({ bytes: media.bytes, mimeType: media.mimeType });
  } catch {
    /* Retain file and request a readable replacement. */
  }
  const { data, error } = await input.supabase.rpc("service_record_demi_group_receipt", {
    p_studio: input.studioId,
    p_conversation: input.conversationId,
    p_group: lookup.data.id,
    p_event: input.eventId,
    p_provider: input.providerMessageId,
    p_media: input.mediaId,
    p_path: path,
    p_hash: digest,
    p_amount: reading?.amountMinor ?? null,
    p_currency: reading?.currency ?? null,
    p_confidence: reading?.confidence ?? 0,
  });
  if (error) throw new Error("group_receipt_record_failed");
  const singleProspect =
    lookup.data.participant_count === 1 && Boolean(lookup.data.prospect_contact_id);
  const reply =
    data?.ok && singleProspect
      ? "Recibí tu comprobante. El pago queda pendiente de validación del equipo. Ahora envíame juntos tu nombre completo y celular mexicano de diez dígitos, sin lada. Todavía no he confirmado tu reserva; revisaré el cupo antes de crearla."
      : data?.ok
        ? "Recibí el comprobante del total del grupo. El pago queda pendiente de validación del equipo. Ahora envíame juntos el nombre completo y celular mexicano de diez dígitos de cada participante, sin lada. Todavía no he confirmado reservas; revisaré cupo y derechos de cada una."
        : data?.reason_code === "partial_payment_received"
          ? `Recibí comprobantes por ${new Intl.NumberFormat("es-MX", { style: "currency", currency: lookup.data.currency }).format(data.received_amount_minor / 100)}. Queda por cubrir ${new Intl.NumberFormat("es-MX", { style: "currency", currency: lookup.data.currency }).format(data.remaining_amount_minor / 100)}. Los comprobantes están pendientes de validación del equipo. Envíame el comprobante de la diferencia; todavía no confirmé reservas.`
          : data?.reason_code === "receipt_amount_mismatch"
          ? "El comprobante no coincide con el total del grupo. No confirmé reservas. Revisa el importe y envíame el comprobante correcto."
          : "No pude aceptar este comprobante para el grupo. No confirmé reservas. Envíame un archivo legible o solicita revisión del equipo.";
  return { handled: true as const, reply, result: data };
}
