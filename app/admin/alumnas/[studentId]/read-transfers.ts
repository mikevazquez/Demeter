import "server-only";

import { getTransferGroupReceiptReviews } from "@/lib/assistant/group-receipt-review";
import type { getAdminContext } from "@/lib/auth/admin-context";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * P360-V2-08 · Pagos por transferencia de la persona.
 * Los comprobantes (enlaces firmados) sólo se preparan en la pestaña Paquetes y pagos.
 */
export async function readTransfers(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  studentId: string,
  { canReadSales, withReceipts }: { canReadSales: boolean; withReceipts: boolean },
) {
  const { data: transferPurchases } = canReadSales
    ? await supabase
        .from("assistant_transfer_purchase_intents")
        .select(
          "id,status,product_template_id,amount_minor,currency,receipt_received_at,receipt_storage_path,receipt_mime_type,receipt_file_size,receipt_stored_at,created_at,validated_at,rejected_at,review_note,sale_id,acquisition_id",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const transferPurchaseRows = transferPurchases ?? [];
  const groupReceiptReviews = await getTransferGroupReceiptReviews(
    supabase,
    studioId,
    withReceipts ? transferPurchaseRows.map((p) => p.id) : [],
  );
  const groupReceiptUrlMap = new Map<string, string>();
  if (withReceipts && groupReceiptReviews.available) {
    const paths = [
      ...new Set(
        [...groupReceiptReviews.byIntent.values()].flatMap((g) => g.documents.map((d) => d.path)),
      ),
    ];
    if (paths.length) {
      const service = createServiceClient();
      const signed = await Promise.all(
        paths.map(async (path) => {
          const { data, error } = await service.storage
            .from("transfer-receipts")
            .createSignedUrl(path, 600);
          return { path, url: error ? null : data?.signedUrl };
        }),
      );
      for (const document of signed)
        if (document.url) groupReceiptUrlMap.set(document.path, document.url);
    }
  }
  const transferReceiptUrlMap = new Map<string, string>();
  if (withReceipts) {
    const receiptRows = transferPurchaseRows.filter(
      (item) => typeof item.receipt_storage_path === "string" && item.receipt_storage_path,
    );
    if (receiptRows.length) {
      const serviceClient = createServiceClient();
      const signed = await Promise.all(
        receiptRows.map(async (item) => {
          const path = String(item.receipt_storage_path);
          const { data, error } = await serviceClient.storage
            .from("transfer-receipts")
            .createSignedUrl(path, 600);
          return {
            id: item.id,
            signedUrl: error ? null : (data?.signedUrl ?? null),
          };
        }),
      );

      for (const item of signed) {
        if (item.signedUrl) transferReceiptUrlMap.set(item.id, item.signedUrl);
      }
    }
  }
  const pendingTransferReviews = transferPurchaseRows.filter(
    (item) => item.status === "provisional_active",
  );

  return {
    transferPurchaseRows,
    groupReceiptReviews,
    groupReceiptUrlMap,
    transferReceiptUrlMap,
    pendingTransferReviews,
  };
}
