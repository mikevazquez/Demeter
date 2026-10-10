import { describe, expect, it } from "vitest";
import { demiDeliveryRetryPolicy } from "../lib/assistant/delivery-retry-policy";

describe("Demi delivery retry boundary", () => {
  it.each([1, 2, 3, 4])("respects configured three attempts at attempt %s", (attempt) => {
    const result = demiDeliveryRetryPolicy({
      errorCode: "demi_uat_injected_delivery_failure",
      retryable: true,
      attempt,
      limit: 3,
    });
    expect(result.retryAllowed).toBe(attempt < 3);
    expect(result.requiresReview).toBe(attempt >= 3);
  });
  it.each([
    "meta_whatsapp_timeout",
    "meta_whatsapp_network_error",
    "meta_whatsapp_message_id_missing",
    "meta_inbox_timeout",
    "reply_persist_failed_after_send",
  ])("does not repeat an unknown outcome: %s", (errorCode) => {
    expect(
      demiDeliveryRetryPolicy({ errorCode, retryable: true, attempt: 1, limit: 3 }),
    ).toMatchObject({ retryAllowed: false, requiresReview: true, outcomeUnknown: true });
  });
  it("escalates a terminal provider rejection immediately", () => {
    expect(
      demiDeliveryRetryPolicy({
        errorCode: "meta_whatsapp_http_401",
        retryable: false,
        attempt: 1,
        limit: 3,
      }),
    ).toMatchObject({ retryAllowed: false, requiresReview: true });
  });
});
