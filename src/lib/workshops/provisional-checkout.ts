import {
  transitionProvisionalTransfer,
  type ProvisionalTransferState,
} from "./provisional-transfer";

export interface ProvisionalCheckoutRequest {
  studioId: string;
  offerId: string;
  studentId: string;
  requestId: string;
  transferReference: string;
  sessionIds: string[];
  amountMinor: number;
  minimumDepositMinor: number;
  expiresAt: string;
}
export interface ProvisionalCheckoutRecord {
  id: string;
  state: ProvisionalTransferState;
  sessionIds: string[];
}
export interface ProvisionalCheckoutStore {
  /**
   * MUST run in one database transaction: tenant/actor validation, deduplicate
   * request and bank reference, lock selected sessions in stable order, verify
   * all available seats including other provisional holds, then persist hold.
   * The store MUST NOT write to sales or payments.
   */
  createHoldAtomically(request: ProvisionalCheckoutRequest): Promise<ProvisionalCheckoutRecord>;
  /**
   * MUST lock the hold, verify staff approval, expiry and capacity; commit the
   * payment to the ledger exactly once, then mark hold confirmed atomically.
   * No payment is recognized merely because this method was requested.
   */
  approveAndPostAtomically(holdId: string, approvedBy: string): Promise<ProvisionalCheckoutRecord>;
}
export type ProvisionalCheckoutResult =
  | { ok: true; hold: ProvisionalCheckoutRecord }
  | { ok: false; reason: "invalid_request" | "insufficient_deposit" | "invalid_transition" };

export async function requestProvisionalCheckout(
  request: ProvisionalCheckoutRequest,
  store: ProvisionalCheckoutStore,
): Promise<ProvisionalCheckoutResult> {
  if (
    !request.studioId ||
    !request.offerId ||
    !request.studentId ||
    !request.requestId ||
    !request.transferReference.trim() ||
    !Number.isSafeInteger(request.amountMinor) ||
    !Number.isSafeInteger(request.minimumDepositMinor) ||
    request.minimumDepositMinor <= 0 ||
    request.amountMinor <= 0 ||
    !Number.isFinite(Date.parse(request.expiresAt)) ||
    request.sessionIds.length === 0 ||
    new Set(request.sessionIds).size !== request.sessionIds.length ||
    request.sessionIds.some((id) => !id)
  )
    return { ok: false, reason: "invalid_request" };
  if (request.amountMinor < request.minimumDepositMinor)
    return { ok: false, reason: "insufficient_deposit" };
  // No client-side preflight substitutes for atomic capacity checks in the store.
  return { ok: true, hold: await store.createHoldAtomically(request) };
}

export async function approveProvisionalCheckout(
  holdId: string,
  approvedBy: string,
  currentState: ProvisionalTransferState,
  store: ProvisionalCheckoutStore,
): Promise<ProvisionalCheckoutResult> {
  if (!holdId || !approvedBy) return { ok: false, reason: "invalid_request" };
  if (!transitionProvisionalTransfer(currentState, "approve_payment").ok)
    return { ok: false, reason: "invalid_transition" };
  // The store MUST re-read current state under lock; this input is not authoritative.
  return { ok: true, hold: await store.approveAndPostAtomically(holdId, approvedBy) };
}
