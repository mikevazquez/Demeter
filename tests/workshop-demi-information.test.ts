import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/assistant/program-information", () => ({
  getActivityProgramInformation: vi.fn().mockResolvedValue({ data: [], error: null }),
}));
import { getActivityProgramInformation } from "@/lib/assistant/program-information";
import { getWorkshopInformation } from "@/lib/assistant/workshop-information";

const rpc = vi.fn();
const context = {
  supabase: { rpc } as never,
  studio: { id: "trusted-studio", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
  conversationId: "trusted-conversation",
};

describe("workshop information and conversation recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActivityProgramInformation).mockResolvedValue({ data: [], error: null });
  });
  it("uses the owned conversation and preserves payment state while presenting studio-local dates", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: {
        ok: true,
        enabled: true,
        current_purchase: { status: "reserved_provisionally", payment_verified: false },
        workshops: [
          {
            title: "Taller UAT",
            full_price_minor: 60000,
            sessions: [
              { session_ref: "session:exact", starts_at: "2026-12-05T02:00:00Z", available: 1 },
            ],
          },
        ],
      },
    });
    const result = await getWorkshopInformation(context);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("service_demi_workshop_context", {
      p_studio: "trusted-studio",
      p_conversation: "trusted-conversation",
    });
    expect(result).toMatchObject({
      ok: true,
      availability_is_guaranteed: false,
      current_purchase: { status: "reserved_provisionally", payment_verified: false },
      workshops: [
        {
          full_price_minor: 60000,
          sessions: [
            {
              session_ref: "session:exact",
              date_local: "2026-12-04",
              starts_at_local: "20:00",
              available: 1,
            },
          ],
        },
      ],
    });
  });
  it("keeps disabled distinct from an empty enabled catalogue", async () => {
    for (const enabled of [false, true]) {
      rpc.mockResolvedValue({
        error: null,
        data: { ok: true, enabled, workshops: [], current_purchase: null },
      });
      expect(await getWorkshopInformation(context)).toMatchObject({
        ok: true,
        enabled,
        workshops: [],
      });
    }
  });
  it("supports an informational visitor without accepting another person's identity", async () => {
    rpc.mockResolvedValue({ error: null, data: { ok: true, enabled: true, workshops: [] } });
    await getWorkshopInformation({ ...context, conversationId: undefined });
    expect(rpc).toHaveBeenCalledWith("service_demi_workshop_context", {
      p_studio: "trusted-studio",
      p_conversation: null,
    });
  });
  it.each([
    { data: null, error: { message: "unavailable" } },
    { data: { ok: true, workshops: null }, error: null },
    { data: { ok: false, workshops: [] }, error: null },
  ])("never presents an unavailable read as an empty catalogue", async (response) => {
    rpc.mockResolvedValue(response);
    expect(await getWorkshopInformation(context)).toEqual({
      ok: false,
      reason_code: "workshop_catalog_unavailable",
    });
  });
});
