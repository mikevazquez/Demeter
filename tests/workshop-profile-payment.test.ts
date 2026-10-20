import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { registerWorkshopPayment } from "@/app/admin/alumnas/[studentId]/workshop-actions";

const purchaseId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";

function form(amount = "300.00") {
  const data = new FormData();
  data.set("purchase_id", purchaseId);
  data.set("student_id", studentId);
  data.set("payment_amount", amount);
  data.set("payment_method", "efectivo");
  data.set("payment_reference", "ABONO-01");
  data.set("payment_notes", "Segundo abono");
  data.set("payment_received", "on");
  return data;
}

describe("student workshop installment payment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({
      studio: { id: "studio-1" },
      can: () => true,
      supabase: { rpc: mocks.rpc },
    });
  });

  it("registers the payment against the workshop purchase and refreshes the student profile", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        purchase_id: purchaseId,
        sale_id: "sale-1",
        paid_minor: 60000,
        balance_minor: 0,
      },
      error: null,
    });

    const result = await registerWorkshopPayment({ error: null }, form());

    expect(mocks.rpc).toHaveBeenCalledWith("admin_register_workshop_payment", {
      p_studio_id: "studio-1",
      p_purchase_id: purchaseId,
      p_payment_amount_minor: 30000,
      p_payment_method: "efectivo",
      p_payment_reference: "ABONO-01",
      p_payment_notes: "Segundo abono",
    });
    expect(result).toEqual({ error: null, paidMinor: 60000, balanceMinor: 0 });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/alumnas/${studentId}`);
  });

  it("rejects an invalid amount before writing", async () => {
    const result = await registerWorkshopPayment({ error: null }, form("300.999"));
    expect(result.error).toContain("Revisa el monto");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces a payment that exceeds the outstanding balance", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "payment_exceeds_balance" } });
    const result = await registerWorkshopPayment({ error: null }, form("400"));
    expect(result.error).toContain("mayor al saldo");
  });
  it("requires explicit received-funds attestation and a replay reference", async () => {
    const data = form();
    data.delete("payment_received");
    expect((await registerWorkshopPayment({ error: null }, data)).error).toBeTruthy();
    const noReference = form();
    noReference.delete("payment_reference");
    expect((await registerWorkshopPayment({ error: null }, noReference)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not retry an unknown outcome", async () => {
    mocks.rpc.mockRejectedValue(new Error("connection lost"));
    expect((await registerWorkshopPayment({ error: null }, form())).error).toContain("historial");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
