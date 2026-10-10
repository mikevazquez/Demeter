import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaDownloadedMedia } from "./meta-whatsapp-channel";
import { downloadMetaInboxAttachment, type MetaInboxInboundMessage } from "./meta-inbox-channel";
import { handleDemiGroupReceipt } from "./group-booking";
import { handleDemiEnrollmentReceipt } from "./enrollment-payment";

export async function handleDemiMetaInboxReceipt(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  eventId: string;
  message: MetaInboxInboundMessage;
}) {
  const pending = await input.supabase
    .from("demi_group_bookings")
    .select("id")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("status", "awaiting_receipt")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (pending.error) throw new Error("group_receipt_lookup_failed");
  const enrollment = !pending.data
    ? await input.supabase
        .from("assistant_enrollment_intents")
        .select("id")
        .eq("studio_id", input.studioId)
        .eq("conversation_id", input.conversationId)
        .eq("payment_method", "bank_transfer")
        .in("status", ["receipt_required", "human_review", "rejected"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  if (enrollment?.error) throw new Error("enrollment_receipt_lookup_failed");
  if (!pending.data && !enrollment?.data) return { handled: false as const };
  if (!input.message.attachmentUrl) throw new Error("meta_attachment_unavailable");
  const source = await input.supabase
    .from("assistant_meta_inbox_events")
    .select("id")
    .eq("id", input.eventId)
    .eq("studio_id", input.studioId)
    .eq("assistant_conversation_id", input.conversationId)
    .eq("provider", input.message.provider)
    .eq("provider_event_id", input.message.providerMessageId)
    .eq("provider_account_id", input.message.providerAccountId)
    .eq("provider_contact_id", input.message.providerContactId)
    .maybeSingle();
  if (source.error || !source.data) throw new Error("meta_receipt_source_invalid");
  const media = await downloadMetaInboxAttachment(input.message.attachmentUrl);
  const providerId = `meta-inbox-receipt:${input.message.provider}:${input.message.providerMessageId}`;
  // The existing payment RPCs reference this receipt table. This is an internal
  // receipt bridge, not evidence that a WhatsApp message was received.
  const bridge = await input.supabase.from("assistant_whatsapp_events").upsert(
    {
      id: input.eventId,
      studio_id: input.studioId,
      assistant_conversation_id: input.conversationId,
      provider: "meta_whatsapp",
      provider_event_id: providerId,
      phone_number_id: input.message.providerAccountId,
      contact_wa_id: input.message.providerContactId,
      message_type: media.mimeType === "application/pdf" ? "document" : "image",
      media_id: providerId,
      payload_fingerprint: `meta-inbox-source:${input.eventId}`,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (bridge.error) throw new Error("meta_receipt_bridge_failed");
  const receiptHandler = pending.data ? handleDemiGroupReceipt : handleDemiEnrollmentReceipt;
  return receiptHandler({
    supabase: input.supabase,
    studioId: input.studioId,
    conversationId: input.conversationId,
    eventId: input.eventId,
    providerMessageId: providerId,
    mediaId: providerId,
    messageType: "image",
    downloadedMedia: media as MetaDownloadedMedia,
  });
}
