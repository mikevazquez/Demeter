export type WorkshopSelection =
  | { mode: "full" }
  | { mode: "sessions"; sessionIds: string[] };

export interface WorkshopSessionOffer {
  id: string;
  priceMinor: number | null;
  capacityRemaining: number;
}

export interface WorkshopOffer {
  workshopId: string;
  fullPriceMinor: number;
  allowIndividualSessions: boolean;
  sessions: WorkshopSessionOffer[];
}

export type WorkshopQuote =
  | { ok: true; sessionIds: string[]; totalMinor: number }
  | { ok: false; reason: "invalid_offer" | "empty_selection" | "invalid_session" | "individual_disabled" | "sold_out" | "price_unavailable" };

export function quoteWorkshopPurchase(offer: WorkshopOffer, selection: WorkshopSelection): WorkshopQuote {
  if (!Number.isSafeInteger(offer.fullPriceMinor) || offer.fullPriceMinor < 0 ||
      offer.sessions.length === 0 || new Set(offer.sessions.map(s => s.id)).size !== offer.sessions.length)
    return { ok: false, reason: "invalid_offer" };
  const all = new Map(offer.sessions.map(s => [s.id, s]));
  const ids = selection.mode === "full" ? offer.sessions.map(s => s.id) : selection.sessionIds;
  if (!ids.length) return { ok: false, reason: "empty_selection" };
  if (selection.mode === "sessions" && !offer.allowIndividualSessions)
    return { ok: false, reason: "individual_disabled" };
  if (new Set(ids).size !== ids.length || ids.some(id => !all.has(id)))
    return { ok: false, reason: "invalid_session" };
  if (ids.some(id => (all.get(id)?.capacityRemaining ?? 0) < 1))
    return { ok: false, reason: "sold_out" };
  if (selection.mode === "full")
    return { ok: true, sessionIds: ids, totalMinor: offer.fullPriceMinor };
  let total = 0;
  for (const id of ids) {
    const price = all.get(id)?.priceMinor;
    if (price == null || !Number.isSafeInteger(price) || price < 0)
      return { ok: false, reason: "price_unavailable" };
    total += price;
    if (!Number.isSafeInteger(total)) return { ok: false, reason: "invalid_offer" };
  }
  return { ok: true, sessionIds: ids, totalMinor: total };
}

/** Quoting is advisory; checkout MUST revalidate all capacities inside one DB transaction. */
export function calculateDeposit(totalMinor: number, deposit: { mode: "full" } | { mode: "fixed"; amountMinor: number } | { mode: "percent"; percent: number }): { dueNowMinor: number; balanceMinor: number } {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new Error("Invalid total");
  let dueNowMinor: number;
  if (deposit.mode === "full") dueNowMinor = totalMinor;
  else if (deposit.mode === "fixed") dueNowMinor = deposit.amountMinor;
  else dueNowMinor = Math.ceil(totalMinor * deposit.percent / 100);
  if (!Number.isSafeInteger(dueNowMinor) || dueNowMinor < 0 || dueNowMinor > totalMinor ||
      (deposit.mode === "percent" && (!Number.isFinite(deposit.percent) || deposit.percent < 0 || deposit.percent > 100)))
    throw new Error("Invalid deposit");
  return { dueNowMinor, balanceMinor: totalMinor - dueNowMinor };
}
