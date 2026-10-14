import {
  calculateDeposit,
  quoteWorkshopPurchase,
  type WorkshopOffer,
  type WorkshopSelection,
} from "./purchase-quote";
import type { OverdueBalancePolicy } from "./overdue-policy";

export interface WorkshopCheckoutSettings {
  requiresEnrollment: boolean;
  enrollmentValid: boolean;
  deposit: Parameters<typeof calculateDeposit>[1];
  dueAt: string | null;
  overduePolicy: OverdueBalancePolicy;
}

export type WorkshopCheckoutPlan =
  | {
      ok: true;
      sessionIds: string[];
      totalMinor: number;
      dueNowMinor: number;
      balanceMinor: number;
      dueAt: string | null;
      overduePolicy: OverdueBalancePolicy;
    }
  | { ok: false; reason: string };

/**
 * Generates a deterministic, side-effect-free checkout plan.
 * This is NOT a payment confirmation or reservation. Server-side checkout must
 * recheck studio ownership, enrollment, price, capacity and payment in one transaction.
 */
export function planWorkshopCheckout(
  offer: WorkshopOffer,
  selection: WorkshopSelection,
  settings: WorkshopCheckoutSettings,
): WorkshopCheckoutPlan {
  if (settings.requiresEnrollment && !settings.enrollmentValid)
    return { ok: false, reason: "enrollment_required" };
  const quote = quoteWorkshopPurchase(offer, selection);
  if (!quote.ok) return quote;
  let amounts: ReturnType<typeof calculateDeposit>;
  try {
    amounts = calculateDeposit(quote.totalMinor, settings.deposit);
  } catch {
    return { ok: false, reason: "invalid_deposit" };
  }
  if (amounts.balanceMinor > 0 && (!settings.dueAt || !Number.isFinite(Date.parse(settings.dueAt))))
    return { ok: false, reason: "balance_due_date_required" };
  if (
    settings.overduePolicy.mode === "release_after_grace" &&
    (!Number.isSafeInteger(settings.overduePolicy.graceMinutes) ||
      settings.overduePolicy.graceMinutes < 0)
  )
    return { ok: false, reason: "invalid_grace" };
  return {
    ok: true,
    sessionIds: quote.sessionIds,
    totalMinor: quote.totalMinor,
    dueNowMinor: amounts.dueNowMinor,
    balanceMinor: amounts.balanceMinor,
    dueAt: amounts.balanceMinor > 0 ? settings.dueAt : null,
    overduePolicy: settings.overduePolicy,
  };
}
