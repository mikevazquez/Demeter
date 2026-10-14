export type OverdueBalancePolicy =
  | { mode: "keep_and_notify" }
  | { mode: "release_after_grace"; graceMinutes: number };

export interface WorkshopPurchasePolicySnapshot {
  studioId: string;
  workshopId: string;
  purchaseId: string;
  totalMinor: number;
  dueAt: string;
  overduePolicy: OverdueBalancePolicy;
}

export interface BalanceDecisionInput {
  snapshot: WorkshopPurchasePolicySnapshot;
  paidMinor: number;
  evaluatedAt: string;
  alreadyReleased: boolean;
}

export type BalanceDecision =
  | { action: "none"; reason: "paid" | "not_due" | "already_released" }
  | { action: "notify"; reason: "overdue_keep" | "within_grace" }
  | { action: "release"; reason: "grace_expired" };

/** Pure policy evaluator. Caller MUST recheck payment and lock reservations atomically before release. */
export function decideOverdueBalance(input: BalanceDecisionInput): BalanceDecision {
  const { snapshot, paidMinor, evaluatedAt, alreadyReleased } = input;
  if (!Number.isSafeInteger(snapshot.totalMinor) || snapshot.balanceDueMinor < 0)
    throw new Error("Invalid purchase total");
  if (!Number.isSafeInteger(paidMinor) || paidMinor < 0)
    throw new Error("Invalid paid amount");
  const due = Date.parse(snapshot.dueAt);
  const now = Date.parse(evaluatedAt);
  if (!Number.isFinite(due) || !Number.isFinite(now)) throw new Error("Invalid date");
  if (alreadyReleased) return { action: "none", reason: "already_released" };
  if (paidMinor >= snapshot.balanceDueMinor) return { action: "none", reason: "paid" };
  if (now <= due) return { action: "none", reason: "not_due" };
  if (snapshot.overduePolicy.mode === "keep_and_notify")
    return { action: "notify", reason: "overdue_keep" };
  const grace = snapshot.overduePolicy.graceMinutes;
  if (!Number.isSafeInteger(grace) || grace < 0) throw new Error("Invalid grace period");
  if (now <= due + grace * 60_000)
    return { action: "notify", reason: "within_grace" };
  return { action: "release", reason: "grace_expired" };
}
