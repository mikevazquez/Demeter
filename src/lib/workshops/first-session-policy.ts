/** Approved full-workshop rules. Pure decisions only: no reservation/payment writes. */
export interface FullWorkshopPurchasePolicyInput {
  sessionStartsAt: string[];
  totalMinor: number;
  paidMinor: number;
  minimumDepositMinor: number;
}

export type FullWorkshopPolicyResult =
  | { ok: true; dueAt: string | null; balanceMinor: number; canReserveAll: boolean }
  | { ok: false; reason: "invalid_amount" | "invalid_sessions" };

export function fullWorkshopPurchasePolicy(
  input: FullWorkshopPurchasePolicyInput,
): FullWorkshopPolicyResult {
  const { totalMinor, paidMinor, minimumDepositMinor, sessionStartsAt } = input;
  if (![totalMinor, paidMinor, minimumDepositMinor].every(Number.isSafeInteger) ||
      totalMinor <= 0 || paidMinor < 0 || paidMinor > totalMinor ||
      minimumDepositMinor <= 0 || minimumDepositMinor > totalMinor)
    return { ok: false, reason: "invalid_amount" };
  const timestamps = sessionStartsAt.map((value) => Date.parse(value));
  if (timestamps.length < 2 || timestamps.some((time) => !Number.isFinite(time)) ||
      new Set(timestamps).size !== timestamps.length)
    return { ok: false, reason: "invalid_sessions" };
  const balanceMinor = totalMinor - paidMinor;
  return {
    ok: true,
    dueAt: balanceMinor > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
    balanceMinor,
    canReserveAll: paidMinor >= minimumDepositMinor,
  };
}

export type ContinuationDecision = "continue" | "withdraw" | "unanswered";
export type ContinuationAction = "keep_future_reservations" | "release_future_reservations";

export function actionAfterFirstSessionAbsence(decision: ContinuationDecision): ContinuationAction {
  return decision === "withdraw" ? "release_future_reservations" : "keep_future_reservations";
}
