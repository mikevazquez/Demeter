import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { recordWorkshopContinuation } from "@/app/admin/alumnas/[studentId]/workshop-actions";
const id = "00000000-0000-4000-8000-000000000001";
function form() {
  const f = new FormData();
  f.set("purchase_id", id);
  f.set("request_id", id);
  f.set("reason", "Confirmó la baja");
  f.set("withdraw_confirmed", "on");
  f.set("studio_id", "forged");
  return f;
}
describe("workshop withdrawal action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({
      studio: { id: "verified-studio" },
      can: () => true,
      supabase: { rpc: mocks.rpc },
    });
  });
  it("requires the staff attestation and capabilities before mutation", async () => {
    const f = form();
    f.delete("withdraw_confirmed");
    expect((await recordWorkshopContinuation({ error: null }, f)).error).toBeTruthy();
    mocks.context.mockResolvedValueOnce({ can: () => false });
    expect((await recordWorkshopContinuation({ error: null }, form())).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the authenticated studio and returns the audited release result", async () => {
    mocks.rpc.mockResolvedValue({ data: { purchase_id: id, released_count: 2 }, error: null });
    expect(await recordWorkshopContinuation({ error: null }, form())).toEqual({
      error: null,
      releasedCount: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_record_workshop_continuation", {
      p_studio_id: "verified-studio",
      p_purchase_id: id,
      p_request_id: id,
      p_decision: "withdraw",
      p_reason: "Confirmó la baja",
    });
  });
  it("requires a fresh history check after a lost response, without issuing a second mutation", async () => {
    mocks.rpc.mockRejectedValue(new Error("connection lost"));
    expect((await recordWorkshopContinuation({ error: null }, form())).error).toContain(
      "Actualiza el historial",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
