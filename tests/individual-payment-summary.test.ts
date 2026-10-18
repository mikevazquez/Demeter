import { describe, expect, it } from "vitest";
import { individualPaymentSummary } from "@/lib/reservations/individual-payment-summary";

const paidClass = {
  commercialStatus: "paid",
  classKind: "drop_in",
  amountMinor: 15000,
  currency: "MXN",
  locale: "es-MX",
};

describe("Individual class payment summary", () => {
  it("shows the saved $150 payment in pesos, not minor units", () => {
    expect(individualPaymentSummary(paidClass)).toBe("$150.00 pagados");
  });
  it("supports a confirmed payment when legacy reservations have no class-kind column", () => {
    expect(individualPaymentSummary({ ...paidClass, classKind: null })).toBe("$150.00 pagados");
  });
  it("does not call a pending payment paid", () => {
    expect(
      individualPaymentSummary({ ...paidClass, commercialStatus: "payment_pending" }),
    ).toBeNull();
  });
  it("does not invent an amount when the saved payment amount is missing", () => {
    expect(individualPaymentSummary({ ...paidClass, amountMinor: null })).toBeNull();
  });
  it("does not describe a trial or package as a paid normal class", () => {
    expect(individualPaymentSummary({ ...paidClass, classKind: "trial" })).toBeNull();
    expect(
      individualPaymentSummary({ ...paidClass, commercialStatus: "package_covered" }),
    ).toBeNull();
  });
  it("rejects invalid payment amounts", () => {
    for (const amountMinor of [0, -15000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(individualPaymentSummary({ ...paidClass, amountMinor })).toBeNull();
    }
  });
});
