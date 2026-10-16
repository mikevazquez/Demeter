/** Pure contract for a workshop transfer awaiting staff validation.
 * No database writes or financial posting are performed here.
 * Capacity locking, authorization and idempotency must be enforced by the server.
 */
export type ProvisionalTransferState =
  | "proof_received"
  | "reserved_provisionally"
  | "confirmed"
  | "rejected"
  | "expired";

export type ProvisionalTransferEvent =
  | "hold_capacity"
  | "approve_payment"
  | "reject_proof"
  | "expire_hold";

export type ProvisionalTransferTransition =
  | { ok: true; state: ProvisionalTransferState; changed: boolean }
  | { ok: false; reason: "invalid_transition" };

const transitions: Record<ProvisionalTransferState, Partial<Record<ProvisionalTransferEvent, ProvisionalTransferState>>> = {
  proof_received: { hold_capacity: "reserved_provisionally", reject_proof: "rejected" },
  reserved_provisionally: { approve_payment: "confirmed", reject_proof: "rejected", expire_hold: "expired" },
  confirmed: {},
  rejected: {},
  expired: {},
};

/** Identical repeated events are safe; terminal states cannot be resurrected. */
export function transitionProvisionalTransfer(
  state: ProvisionalTransferState,
  event: ProvisionalTransferEvent,
): ProvisionalTransferTransition {
  const next = transitions[state][event];
  if (next) return { ok: true, state: next, changed: true };
  if (
    (state === "reserved_provisionally" && event === "hold_capacity") ||
    (state === "confirmed" && event === "approve_payment") ||
    (state === "rejected" && event === "reject_proof") ||
    (state === "expired" && event === "expire_hold")
  ) return { ok: true, state, changed: false };
  return { ok: false, reason: "invalid_transition" };
}

export function countsAsConfirmedIncome(state: ProvisionalTransferState): boolean {
  return state === "confirmed";
}
