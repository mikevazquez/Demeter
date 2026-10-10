import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GroupReceiptReview = {
  groupId: string;
  amountMinor: number;
  currency: string;
  documents: { id: string; path: string; amountMinor: number | null; status: string }[];
};

export async function getTransferGroupReceiptReviews(
  supabase: SupabaseClient,
  studioId: string,
  intentIds: string[],
) {
  const byIntent = new Map<string, GroupReceiptReview>();
  if (!intentIds.length) return { available: true, byIntent };
  const participants = await supabase
    .from("demi_group_participants")
    .select("group_id,transfer_intent_id")
    .in("transfer_intent_id", intentIds)
    .limit(201);
  if (participants.error || (participants.data?.length ?? 0) > 200)
    return { available: false, byIntent };
  const groupIds = [...new Set((participants.data ?? []).map((p) => String(p.group_id)))];
  if (!groupIds.length) return { available: true, byIntent };
  const [groups, receipts] = await Promise.all([
    supabase
      .from("demi_group_bookings")
      .select("id,amount_minor,currency")
      .eq("studio_id", studioId)
      .in("id", groupIds),
    supabase
      .from("demi_group_receipts")
      .select("id,group_id,storage_path,amount_minor,status")
      .eq("studio_id", studioId)
      .in("group_id", groupIds)
      .order("created_at")
      .limit(201),
  ]);
  if (groups.error || receipts.error || (receipts.data?.length ?? 0) > 200)
    return { available: false, byIntent };
  for (const participant of participants.data ?? []) {
    const group = groups.data?.find((g) => g.id === participant.group_id);
    if (!group || byIntent.has(participant.transfer_intent_id))
      return { available: false, byIntent: new Map<string, GroupReceiptReview>() };
    byIntent.set(participant.transfer_intent_id, {
      groupId: group.id,
      amountMinor: group.amount_minor,
      currency: group.currency,
      documents: (receipts.data ?? [])
        .filter((r) => r.group_id === group.id)
        .map((r) => ({
          id: r.id,
          path: r.storage_path,
          amountMinor: r.amount_minor,
          status: r.status,
        })),
    });
  }
  return { available: true, byIntent };
}
