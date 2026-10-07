import type { SupabaseClient } from "@supabase/supabase-js";

type RecordObject = Record<string, unknown>;
type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type MetaDeliveryStatus = {
  messageId: string;
  status: DeliveryStatus;
  timestamp: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  phoneNumberId: string;
  wabaId: string | null;
};

function object(value: unknown): RecordObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordObject : {};
}
function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractMetaDeliveryStatuses(body: unknown): MetaDeliveryStatus[] {
  const statuses: MetaDeliveryStatus[] = [];
  for (const item of Array.isArray(object(body).entry) ? object(body).entry as unknown[] : []) {
    const entry = object(item);
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = object(object(change).value);
      const phoneNumberId = str(object(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
        const status = object(raw);
        const messageId = str(status.id);
        const statusValue = str(status.status);
        if (!messageId || !["sent", "delivered", "read", "failed"].includes(statusValue ?? "")) continue;
        const error = object(Array.isArray(status.errors) ? status.errors[0] : null);
        statuses.push({
          messageId,
          status: statusValue as DeliveryStatus,
          timestamp: str(status.timestamp),
          errorCode: typeof error.code === "number" ? String(error.code) : str(error.code),
          errorDescription: str(error.message) ?? str(error.title),
          phoneNumberId,
          wabaId: str(entry.id),
        });
      }
    }
  }
  return statuses;
}

const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const safeDescription = (s: string | null) => s?.slice(0, 240) ?? null;

/**
 * Meta's delivery receipts are asynchronous and may arrive out of order.
 * Only update deliveries with a matching provider message id in this studio.
 * No retry or message send is triggered by a receipt.
 */
export async function persistMetaDeliveryStatuses(
  client: SupabaseClient,
  studioId: string,
  statuses: MetaDeliveryStatus[],
  expectedPhoneNumberId: string,
  expectedWabaId: string,
) {
  let updated = 0;
  let ignored = 0;
  for (const status of statuses) {
    if (status.phoneNumberId !== expectedPhoneNumberId ||
        (status.wabaId && status.wabaId !== expectedWabaId)) {
      ignored++;
      continue;
    }

    const { data: deliveries, error: lookupError } = await client
      .from("notification_deliveries")
      .select("id,state,delivered_at,message_snapshot")
      .eq("studio_id", studioId)
      .eq("provider_key", "meta_whatsapp")
      .eq("provider_message_id", status.messageId)
      .limit(5);
    if (lookupError) throw lookupError;

    for (const delivery of deliveries ?? []) {
      const snapshot = object(delivery.message_snapshot);
      const priorStatus = str(snapshot.meta_delivery_status) ??
        (delivery.state === "delivered" ? "delivered" : "accepted");
      if ((RANK[status.status] ?? 0) < (RANK[priorStatus] ?? 0)) continue;
      const state = status.status === "failed" ? "failed_permanent"
        : status.status === "delivered" || status.status === "read" ? "delivered" : delivery.state;
      const { error } = await client.from("notification_deliveries")
        .update({
          state,
          delivered_at: state === "delivered" ? (delivery.delivered_at ?? new Date().toISOString()) : delivery.delivered_at,
          last_error_category: status.status === "failed" ? "provider" : null,
          last_error_code: status.status === "failed" ? (status.errorCode ?? "meta_failed") : null,
          last_error_safe: status.status === "failed" ? safeDescription(status.errorDescription) : null,
          message_snapshot: {
            ...snapshot,
            meta_delivery_status: status.status,
            meta_delivery_timestamp: status.timestamp,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id)
        .eq("studio_id", studioId)
        .in("state", ["accepted", "delivered", "failed_permanent"]);
      if (error) throw error;
      updated++;
    }

    // The conversational assistant uses a narrower status enum. Preserve the
    // callback status in response_snapshot without violating its constraint.
    const { data: assistantRows, error: assistantLookupError } = await client
      .from("assistant_whatsapp_deliveries")
      .select("id,response_snapshot")
      .eq("studio_id", studioId)
      .eq("provider_message_id", status.messageId)
      .limit(5);
    if (assistantLookupError) throw assistantLookupError;
    for (const row of assistantRows ?? []) {
      const snapshot = object(row.response_snapshot);
      const previous = str(snapshot.meta_delivery_status) ?? "accepted";
      if ((RANK[status.status] ?? 0) < (RANK[previous] ?? 0)) continue;
      const { error } = await client.from("assistant_whatsapp_deliveries").update({
        response_snapshot: {
          ...snapshot,
          meta_delivery_status: status.status,
          meta_delivery_timestamp: status.timestamp,
          meta_error_code: status.status === "failed" ? status.errorCode : null,
          meta_error_description: status.status === "failed" ? safeDescription(status.errorDescription) : null,
        },
      }).eq("id", row.id).eq("studio_id", studioId);
      if (error) throw error;
      updated++;
    }
  }
  return { updated, ignored };
}
