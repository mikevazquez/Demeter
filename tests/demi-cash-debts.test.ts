import { describe, expect, it } from "vitest";
import { loadDemiCashDebts, remainingSaleBalance } from "../lib/assistant/cash-debts";
function client(paid = 0, errorTable?: string) {
  const tables: Record<string, unknown[]> = {
    demi_cash_purchases: [
      { sale_id: "sale", student_id: "student", acquisition_id: "acquisition" },
    ],
    sales: [
      {
        id: "sale",
        status: "confirmed",
        total_minor: 100000,
        currency: "MXN",
        payment_due_on: "2026-10-12",
      },
    ],
    payments: paid ? [{ sale_id: "sale", kind: "payment", amount_minor: paid }] : [],
    students: [{ id: "student", full_name: "Karen UAT" }],
  };
  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data: tables[table],
            error: table === errorTable ? { message: "unavailable" } : null,
          }).then(resolve),
      };
      return query;
    },
  } as unknown as Parameters<typeof loadDemiCashDebts>[0];
}
describe("cash debt visibility independent of reservation", () => {
  it("shows a debt before any reservation exists", async () => {
    expect(await loadDemiCashDebts(client(), "studio")).toEqual([
      {
        saleId: "sale",
        studentId: "student",
        acquisitionId: "acquisition",
        studentName: "Karen UAT",
        amountMinor: 100000,
        currency: "MXN",
        dueOn: "2026-10-12",
      },
    ]);
  });
  it("shows only remaining balance after a partial collection", async () => {
    expect((await loadDemiCashDebts(client(40000), "studio"))[0].amountMinor).toBe(60000);
  });
  it("removes settled debt", async () => {
    expect(await loadDemiCashDebts(client(100000), "studio")).toEqual([]);
  });
  it("accounts for refunds rather than assuming cash was collected", () => {
    expect(
      remainingSaleBalance(100000, [
        { kind: "payment", amount_minor: 100000 },
        { kind: "refund", amount_minor: 30000 },
      ]),
    ).toBe(30000);
  });
  it("does not hide a lookup failure as zero debt", async () => {
    await expect(loadDemiCashDebts(client(0, "payments"), "studio")).rejects.toThrow(
      "cash_debts_unavailable",
    );
  });
});
