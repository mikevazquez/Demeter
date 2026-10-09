export function demiDeliveryRetryPolicy(input: {
  errorCode: string;
  retryable: boolean;
  attempt: number;
  limit: number;
}) {
  const definiteFailure =
    /^(?:demi_uat_injected_delivery_failure|meta_(?:whatsapp|inbox)_retry_exhausted|meta_(?:whatsapp|inbox)_http_(?:425|429|5\d\d))$/.test(
      input.errorCode,
    );
  const unknown =
    /timeout|network_error|message_id_missing|persist_failed_after_send/.test(input.errorCode) ||
    (input.retryable && !definiteFailure);
  const limit =
    Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 5 ? input.limit : 3;
  return {
    retryAllowed: input.retryable && !unknown && input.attempt < limit,
    requiresReview: unknown || !input.retryable || input.attempt >= limit,
    outcomeUnknown: unknown,
    attemptLimit: limit,
  };
}
