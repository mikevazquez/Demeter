export const provisionalHoldIdPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export type TransferReviewDecision =
  | { ok: true; holdId: string; decision: "approve"; received: true }
  | { ok: true; holdId: string; decision: "reject"; reason: string }
  | { ok: false; error: string };

export function parseTransferReview(data: FormData): TransferReviewDecision {
  const holdId = String(data.get("hold_id") ?? "");
  const decision = String(data.get("decision") ?? "");
  const reason = String(data.get("reason") ?? "").trim();

  if (!provisionalHoldIdPattern.test(holdId)) {
    return { ok: false, error: "Selecciona un comprobante válido." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Selecciona aprobar o rechazar." };
  }
  if (decision === "approve") {
    if (data.get("payment_received") !== "on") {
      return { ok: false, error: "Verifica el ingreso en el banco antes de aprobar la transferencia." };
    }
    return { ok: true, holdId, decision, received: true };
  }
  if (reason.length < 1 || reason.length > 500) {
    return { ok: false, error: "Indica el motivo del rechazo (máximo 500 caracteres)." };
  }
  return { ok: true, holdId, decision, reason };
}
