import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { purchaseWorkshop } from "@/app/admin/actividades/talleres/actions";

const id = "00000000-0000-4000-8000-000000000001";
function form() {
  const data = new FormData();
  data.set("offer_revision", "1");
  for (const name of ["offer_id", "student_id", "request_id", "session_ids"]) data.set(name, id);
  data.set("purchase_mode", "sessions");
  data.set("received_amount", "300.29");
  data.set("payment_method", "bank_transfer");
  data.set("reference", " BANK-29 ");
  data.set("payment_received", "on");
  data.set("studio_id", "forged-tenant");
  data.set("total_minor", "1");
  data.set("authorization_id", "forged-authorization");
  return data;
}
describe("authenticated workshop server action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({
      studio: { id: "signed-studio" },
      can: () => true,
      supabase: { rpc: mocks.rpc },
    });
  });
  it("derives tenant from authenticated context and forwards only received funds and explicit selection", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        purchase_id: id,
        sale_id: id,
        total_minor: 60000,
        paid_minor: 30029,
        replayed: false,
      },
      error: null,
    });
    const result = await purchaseWorkshop({ error: null }, form());
    expect(mocks.context).toHaveBeenCalledWith("sales.write");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_purchase_workshop_checked", {
      p_studio_id: "signed-studio",
      p_offer_id: id,
      p_student_id: id,
      p_session_ids: [id],
      p_purchase_mode: "sessions",
      p_request_id: id,
      p_received_amount_minor: 30029,
      p_payment_method: "bank_transfer",
      p_reference: "BANK-29",
      p_received: true,
      p_expected_revision: 1,
    });
    expect(result.receipt).toMatchObject({ saleId: id, paidMinor: 30029 });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/ventas/${id}`);
  });
  it("does not call checkout without schedule permission or received-funds attestation", async () => {
    mocks.context.mockResolvedValueOnce({ can: () => false });
    expect((await purchaseWorkshop({ error: null }, form())).receipt).toBeUndefined();
    const data = form();
    data.delete("payment_received");
    expect((await purchaseWorkshop({ error: null }, data)).receipt).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not report success or revalidate after a capacity rejection", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "session_full" } });
    const result = await purchaseWorkshop({ error: null }, form());
    expect(result.error).toContain("sin cupo");
    expect(result.receipt).toBeUndefined();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("handles a lost response without inventing a confirmation", async () => {
    mocks.rpc.mockRejectedValue(new Error("network"));
    const result = await purchaseWorkshop({ error: null }, form());
    expect(result.error).toContain("misma referencia");
    expect(result.receipt).toBeUndefined();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
