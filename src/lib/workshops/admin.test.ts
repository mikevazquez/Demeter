import { describe, expect, it } from "vitest";
import { receivedAmountMinor, workshopPurchaseInput } from "./admin";

describe("workshop received money input", () => {
  it.each([
    ["0.29", 29],
    ["150.5", 15050],
    ["600", 60000],
    ["21474836.47", 2147483647],
  ])("parses %s exactly in cents", (text, minor) => {
    expect(receivedAmountMinor(text)).toBe(minor);
  });
  it.each(["", "-1", "0", "0.001", "1e3", "NaN", "1,500", "21474836.48"])(
    "rejects ambiguous or invalid amount %s",
    (text) => {
      expect(receivedAmountMinor(text)).toBeNull();
    },
  );
  it("preserves explicit individual selection even when every session is chosen, and ignores client totals/tenant", () => {
    const data = new FormData();
    for (const name of ["offer_id", "student_id", "request_id"])
      data.set(name, "00000000-0000-4000-8000-000000000001");
    data.append("session_ids", "00000000-0000-4000-8000-000000000002");
    data.append("session_ids", "00000000-0000-4000-8000-000000000003");
    data.set("purchase_mode", "sessions");
    data.set("received_amount", "300.00");
    data.set("payment_method", "bank_transfer");
    data.set("reference", " BANK-1 ");
    data.set("payment_received", "on");
    data.set("studio_id", "forged");
    data.set("total_minor", "1");
    const result = workshopPurchaseInput(data);
    expect(result).toMatchObject({
      ok: true,
      mode: "sessions",
      amountMinor: 30000,
      reference: "BANK-1",
    });
    expect(result).not.toHaveProperty("studioId");
    expect(result).not.toHaveProperty("totalMinor");
    data.append("session_ids", "00000000-0000-4000-8000-000000000002");
    expect(workshopPurchaseInput(data).ok).toBe(false);
  });
});
