import "server-only";

import type { getAdminContext } from "@/lib/auth/admin-context";

export type StudentSaleHistory = {
  id: string;
  folio: string;
  totalMinor: number;
  status: string;
  createdAt: string;
  netPaidMinor: number;
  balanceMinor: number;
  stateLabel: string;
};

type SaleRow = {
  id: string;
  folio: string;
  total_minor: number;
  status: string;
  created_at: string;
};

/** P360-V2-08 · Ventas de la persona con lo pagado, el saldo y el valor histórico neto. */
export async function summarizeSales(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  studentSales: SaleRow[],
) {
  const saleIds = studentSales.map((sale) => sale.id);
  const { data: payments } = saleIds.length
    ? await supabase
        .from("payments")
        .select("sale_id,kind,amount_minor")
        .eq("studio_id", studioId)
        .in("sale_id", saleIds)
    : { data: [] };

  const grossPaidBySale = new Map<string, number>();
  const refundsBySale = new Map<string, number>();

  for (const payment of payments ?? []) {
    const target = payment.kind === "refund" ? refundsBySale : grossPaidBySale;
    target.set(payment.sale_id, (target.get(payment.sale_id) ?? 0) + payment.amount_minor);
  }

  const studentSalesHistory: StudentSaleHistory[] = studentSales.map((sale) => {
    const grossPaid = grossPaidBySale.get(sale.id) ?? 0;
    const refunded = refundsBySale.get(sale.id) ?? 0;
    const netPaidMinor = grossPaid - refunded;
    const balanceMinor = Math.max(0, sale.total_minor - netPaidMinor);
    const stateLabel =
      sale.status === "voided"
        ? "Anulada"
        : refunded > 0
          ? refunded >= grossPaid && grossPaid > 0
            ? "Reembolsada"
            : "Con reembolso"
          : netPaidMinor <= 0
            ? "Pendiente"
            : netPaidMinor < sale.total_minor
              ? "Parcial"
              : "Pagada";

    return {
      id: sale.id,
      folio: sale.folio,
      totalMinor: sale.total_minor,
      status: sale.status,
      createdAt: sale.created_at,
      netPaidMinor,
      balanceMinor,
      stateLabel,
    };
  });

  const confirmedSales = studentSalesHistory.filter((sale) => sale.status === "confirmed");
  const historicalValueMinor = confirmedSales.reduce((sum, sale) => sum + sale.netPaidMinor, 0);
  const pendingBalanceMinor = confirmedSales.reduce((sum, sale) => sum + sale.balanceMinor, 0);

  return { studentSalesHistory, historicalValueMinor, pendingBalanceMinor };
}
