import type { SupabaseClient } from "@supabase/supabase-js";

const TEXT_MESSAGE_TYPES = ["text", "button", "interactive"];

/** Only prepared text turns can replace another text reply. Media acknowledgements
 * and cached delivery retries have their own processing and must stay independent. */
export async function isWhatsAppTextTurnSuperseded(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  eventId: string;
  messageType: string;
}) {
  if (!TEXT_MESSAGE_TYPES.includes(input.messageType)) return false;

  const { data, error } = await input.supabase
    .from("assistant_whatsapp_events")
    .select("id")
    .eq("studio_id", input.studioId)
    .eq("provider", "meta_whatsapp")
    .eq("assistant_conversation_id", input.conversationId)
    .in("message_type", TEXT_MESSAGE_TYPES)
    .not("inbound_turn_id", "is", null)
    // Provider timestamps have only second precision and may arrive out of order.
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) throw new Error("whatsapp_turn_order_unavailable");
  return data.id !== input.eventId;
}
