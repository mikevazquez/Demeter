"use client";
import { useActionState } from "react";
import { recordWorkshopContinuation } from "./workshop-actions";
export function WorkshopWithdrawal({
  purchaseId,
  requestId,
}: {
  purchaseId: string;
  requestId: string;
}) {
  const [state, action, pending] = useActionState(recordWorkshopContinuation, { error: null });
  if (state.releasedCount !== undefined)
    return (
      <p role="status">
        Baja registrada. Se liberaron {state.releasedCount} reservas futuras. Los pagos y el saldo
        se conservan.
      </p>
    );
  return (
    <details>
      <summary>Registrar abandono confirmado</summary>
      <form action={action}>
        <input type="hidden" name="purchase_id" value={purchaseId} />
        <input type="hidden" name="request_id" value={requestId} />
        <p>
          Solo se liberan las fechas futuras de esta compra. No se devuelven pagos ni se condona el
          saldo.
        </p>
        <label>
          Motivo de la baja
          <input name="reason" required minLength={3} maxLength={1000} />
        </label>
        <label>
          <input type="checkbox" name="withdraw_confirmed" required />
          La alumna confirmó que no continuará y conoce las condiciones.
        </label>
        {state.error ? <p role="alert">{state.error}</p> : null}
        <button disabled={pending}>{pending ? "Registrando…" : "Confirmar baja del taller"}</button>
      </form>
    </details>
  );
}
