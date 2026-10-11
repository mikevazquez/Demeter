import { describe, expect, it } from "vitest";
import { campaignState } from "../lib/notifications/campaigns";
const tracking = { total: 10, eligible: 8, sent: 0, pending: 8, responded: 0, purchased: 0 };
describe("Campaign delivery status", () => {
  it("keeps scheduled messages distinct from delivered messages", () =>
    expect(campaignState("scheduled", tracking)).toBe("Programada"));
  it("does not claim success while any recipient remains queued", () =>
    expect(campaignState("queued", { ...tracking, sent: 3, pending: 5 })).toBe("En cola"));
  it("requires actual accepted deliveries before showing sent", () => {
    expect(campaignState("queued", { ...tracking, pending: 0 })).toBe("Sin entregas");
    expect(campaignState("queued", { ...tracking, sent: 8, pending: 0 })).toBe("Enviada");
  });
  it("does not infer delivery success when tracking cannot load", () =>
    expect(campaignState("queued", null)).toBe("En cola"));
});
