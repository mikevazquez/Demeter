import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { registerWorkshopAbono } from "@/app/admin/hoy/workshop-abono-actions";

const id = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
function form() {
  const data = new FormData();
  for (const key of ["sale_id", "reservation_id", "session_id"]) data.set(key, id);
  data.set("payment_amount", "100");
  data.set("payment_method", "cash");
  data.set("payment_request_id", requestId);
  data.set("return_to", "/admin?date=2026-11-30");
  return data;
}

describe("workshop cash installments from Hoy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({
      studio: { id: "signed-studio" },
      can: () => true,
      supabase: { rpc: mocks.rpc },
    });
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`);
    });
  });
  it("registers cash without a bank reference using a stable request key", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, sale_id: id }, error: null });
    await expect(registerWorkshopAbono(form())).rejects.toThrow("created=workshop-payment");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admin_register_workshop_installment",
      expect.objectContaining({
        p_studio_id: "signed-studio",
        p_method: "cash",
        p_reference: `cash:${requestId}`,
      }),
    );
    expect(mocks.redirect.mock.calls.at(-1)?.[0]).not.toContain("workshop_payment_request");
  });
  it("keeps the cash request key after an uncertain result and never auto-retries", async () => {
    mocks.rpc.mockRejectedValue(new Error("lost response"));
    await expect(registerWorkshopAbono(form())).rejects.toThrow(
      `workshop_payment_request=${requestId}`,
    );
    expect(mocks.redirect.mock.calls.at(-1)?.[0]).toContain(`workshop_payment_sale=${id}`);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects transfers without a reference even with a cash request key", async () => {
    const data = form();
    data.set("payment_method", "bank_transfer");
    await expect(registerWorkshopAbono(data)).rejects.toThrow("workshop_payment_invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
