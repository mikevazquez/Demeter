import { describe, expect, it, vi } from "vitest";
import { claimDemiTextSend, finishDemiTextSend } from "@/lib/assistant/demi-text-send-claim";

describe("DEMI-378 atomic send claim client", () => {
  it("returns a token only for a successful database claim", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await claimDemiTextSend(rpc, "studio", "event", "token")).toEqual({
      status: "claimed",
      token: "token",
    });
    expect(rpc).toHaveBeenCalledWith("assistant_whatsapp_claim_current_text", {
      p_studio_id: "studio",
      p_event_id: "event",
      p_claim_token: "token",
    });
  });

  it("rejects stale claims and fails closed on RPC errors", async () => {
    const stale = vi.fn().mockResolvedValue({ data: false, error: null });
    const unavailable = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await claimDemiTextSend(stale, "s", "e", "t")).toEqual({ status: "stale" });
    expect(await claimDemiTextSend(unavailable, "s", "e", "t")).toEqual({
      status: "unavailable",
    });
  });

  it("requires explicit confirmation when finishing a claim", async () => {
    const accepted = vi.fn().mockResolvedValue({ data: true, error: null });
    const failed = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await finishDemiTextSend(accepted, "token", "accepted")).toBe(true);
    expect(await finishDemiTextSend(failed, "token", "uncertain")).toBe(false);
  });
});
