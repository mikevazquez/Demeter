import type { SupabaseClient } from "@supabase/supabase-js";

export type CashDebt = {
  saleId: string;
  studentId: string;
  acquisitionId: string;
  studentName: string;
  amountMinor: number;
  currency: string;
  dueOn: string | null;
};

export function remainingSaleBalance(
  total: number,
  payments: { kind: string; amount_minor: number }[],
): number {
  return Math.max(
    0,
    total -
      payments.reduce(
        (sum, payment) =>
          sum + (payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor),
        0,
      ),
  );
}

export async function loadDemiCashDebts(
  supabase: SupabaseClient,
  studioId: string,
): Promise<CashDebt[]> {
  const cash = await supabase
    .from("demi_cash_purchases")
    .select("sale_id,student_id,acquisition_id")
    .eq("studio_id", studioId);
  if (cash.error) throw new Error("cash_debts_unavailable");
  if (!cash.data?.length) return [];
  const saleIds = cash.data.map((item) => item.sale_id);
  const [sales, payments, students] = await Promise.all([
    supabase
      .from("sales")
      .select("id,status,total_minor,currency,payment_due_on")
      .eq("studio_id", studioId)
      .in("id", saleIds)
      .eq("status", "confirmed"),
    supabase
      .from("payments")
      .select("sale_id,kind,amount_minor")
      .eq("studio_id", studioId)
      .in("sale_id", saleIds),
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studioId)
      .in("id", [...new Set(cash.data.map((item) => item.student_id))]),
  ]);
  if (sales.error || payments.error || students.error) throw new Error("cash_debts_unavailable");
  const saleMap = new Map((sales.data ?? []).map((sale) => [sale.id, sale]));
  const nameMap = new Map((students.data ?? []).map((student) => [student.id, student.full_name]));
  return cash.data
    .flatMap((item) => {
      const sale = saleMap.get(item.sale_id);
      if (!sale) return [];
      const balance = remainingSaleBalance(
        sale.total_minor,
        (payments.data ?? []).filter((payment) => payment.sale_id === sale.id),
      );
      return balance > 0
        ? [
            {
              saleId: sale.id,
              studentId: item.student_id,
              acquisitionId: item.acquisition_id,
              studentName: nameMap.get(item.student_id) ?? "Alumna",
              amountMinor: balance,
              currency: sale.currency,
              dueOn: sale.payment_due_on,
            },
          ]
        : [];
    })
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}
