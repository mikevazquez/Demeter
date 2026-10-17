import { describe, expect, it } from "vitest";
import { parseTransferReview } from "./transfer-review";

const holdId = "a5d114a2-f049-4e27-a894-d54b54d37a7a";
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
describe("workshop bank-transfer review input", () => {
  it("requires an explicit received-payment check before approval", () => {
    const result = parseTransferReview(form({ hold_id: holdId, decision: "approve" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Verifica");
  });
  it("allows approval only after explicit attestation", () => {
    expect(
      parseTransferReview(
        form({
          hold_id: holdId,
          decision: "approve",
          payment_received: "on",
        }),
      ),
    ).toEqual({ ok: true, holdId, decision: "approve", received: true });
  });
  it("requires a nonempty rejection reason", () => {
    expect(
      parseTransferReview(form({ hold_id: holdId, decision: "reject", reason: "  " })).ok,
    ).toBe(false);
  });
  it("does not require received funds to reject an invalid proof", () => {
    expect(
      parseTransferReview(
        form({ hold_id: holdId, decision: "reject", reason: "Folio incorrecto" }),
      ),
    ).toEqual({ ok: true, holdId, decision: "reject", reason: "Folio incorrecto" });
  });
  it("rejects invalid hold IDs, unknown decisions and reasons over 500 characters", () => {
    expect(
      parseTransferReview(form({ hold_id: "bad", decision: "approve", payment_received: "on" })).ok,
    ).toBe(false);
    expect(parseTransferReview(form({ hold_id: holdId, decision: "other" })).ok).toBe(false);
    expect(
      parseTransferReview(form({ hold_id: holdId, decision: "reject", reason: "x".repeat(501) }))
        .ok,
    ).toBe(false);
  });
});
