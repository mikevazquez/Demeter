import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveWorkshop } from "@/app/admin/actividades/talleres/editor-actions";
const id = "00000000-0000-4000-8000-000000000001";
function form() {
  const data = new FormData();
  data.set("offer_id", id);
  data.set("request_id", id);
  data.set("revision", "2");
  data.set("payload", JSON.stringify({ title: "Nuevo nombre" }));
  data.set("studio_id", "forged");
  return data;
}
describe("workshop editor action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({
      studio: { id: "signed-studio" },
      can: () => true,
      supabase: { rpc: mocks.rpc },
    });
  });
  it("derives tenant from session and forwards an exact edit revision and request", async () => {
    mocks.rpc.mockResolvedValue({
      data: { offer_id: id, revision: 3, replayed: false },
      error: null,
    });
    const result = await saveWorkshop({ error: null }, form());
    expect(mocks.context).toHaveBeenCalledWith("products.write");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_save_workshop", {
      p_studio_id: "signed-studio",
      p_offer_id: id,
      p_request_id: id,
      p_expected_revision: 2,
      p_draft: { title: "Nuevo nombre" },
    });
    expect(result.saved).toEqual({ offerId: id, revision: 3, replayed: false });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/agenda");
  });
  it("rejects missing schedule permission and malformed requests before RPC", async () => {
    mocks.context.mockResolvedValueOnce({ can: () => false });
    expect((await saveWorkshop({ error: null }, form())).error).toContain("permiso");
    const data = form();
    data.set("revision", "NaN");
    expect((await saveWorkshop({ error: null }, data)).saved).toBeUndefined();
    data.set("revision", "2");
    data.set("payload", "{");
    expect((await saveWorkshop({ error: null }, data)).saved).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("never permits a title-only creation", async () => {
    const data = form();
    data.set("offer_id", "");
    data.set("revision", "");
    expect((await saveWorkshop({ error: null }, data)).error).toContain("precio completo");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves the request after conflicts and lost replies without inventing success", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "workshop_revision_conflict" },
    });
    expect((await saveWorkshop({ error: null }, form())).error).toContain("Otra persona");
    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    expect((await saveWorkshop({ error: null }, form())).error).toContain("misma solicitud");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
