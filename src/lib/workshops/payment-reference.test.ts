import { describe, expect, it } from "vitest";
import { workshopPaymentReference } from "./payment-reference";

const requestId = "00000000-0000-4000-8000-000000000001";

describe("workshop cash payment identity", () => {
  it.each(["cash", "efectivo"])(
    "accepts %s without a bank reference and preserves retry identity",
    (method) => {
      expect(workshopPaymentReference(method, " ", requestId)).toBe(`cash:${requestId}`);
      expect(workshopPaymentReference(method, "", requestId)).toBe(`cash:${requestId}`);
    },
  );
  it("keeps two separate cash payments distinct even if their amounts are equal", () => {
    expect(workshopPaymentReference("cash", "", requestId)).not.toBe(
      workshopPaymentReference("cash", "", "00000000-0000-4000-8000-000000000002"),
    );
  });
  it.each(["bank_transfer", "transferencia"])("requires a bank reference for %s", (method) => {
    expect(workshopPaymentReference(method, "", requestId)).toBeNull();
    expect(workshopPaymentReference(method, "  BANK-01  ", requestId)).toBe("BANK-01");
  });
  it("preserves explicit historical cash receipts and refuses invalid request identities", () => {
    expect(workshopPaymentReference("cash", " RECEIPT-01 ", "")).toBe("RECEIPT-01");
    expect(workshopPaymentReference("cash", "", "invalid")).toBeNull();
    expect(workshopPaymentReference("other", "RECEIPT-01", requestId)).toBeNull();
    expect(workshopPaymentReference("bank_transfer", "x".repeat(201), requestId)).toBeNull();
  });
});
