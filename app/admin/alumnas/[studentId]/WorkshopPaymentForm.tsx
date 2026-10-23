"use client";

import { useActionState, useState } from "react";
import { WorkshopPaymentMethodFields } from "@/components/WorkshopPaymentMethodFields";

import { registerWorkshopPayment } from "./workshop-actions";

type Props = {
  purchaseId: string;
  studentId: string;
  balanceMinor: number;
  currency: string;
  locale: string;
  requestId: string;
};

export function WorkshopPaymentForm({
  purchaseId,
  studentId,
  balanceMinor,
  currency,
  locale,
  requestId,
}: Props) {
  const [state, action, pending] = useActionState(registerWorkshopPayment, { error: null });
  const [initialRequestId] = useState(requestId);
  const currentBalance = state.balanceMinor ?? balanceMinor;
  const balance = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(currentBalance / 100);

  if (state.balanceMinor === 0) {
    return (
      <div className="profile360-workshop-payment-success" role="status">
        Taller liquidado. Pago registrado correctamente.
      </div>
    );
  }

  return (
    <details className="profile360-workshop-payment-form">
      <summary>Registrar abono o liquidación</summary>
      <form action={action} key={currentBalance}>
        <input type="hidden" name="purchase_id" value={purchaseId} />
        <input type="hidden" name="student_id" value={studentId} />
        <input
          type="hidden"
          name="payment_request_id"
          value={state.nextRequestId ?? initialRequestId}
        />

        <div className="profile360-workshop-payment-balance">
          <span>Saldo pendiente</span>
          <strong>{balance}</strong>
        </div>

        <label>
          Monto
          <input
            name="payment_amount"
            required
            inputMode="decimal"
            defaultValue={(currentBalance / 100).toFixed(2)}
            type="number"
            min="0.01"
            step="0.01"
            max={(currentBalance / 100).toFixed(2)}
            disabled={pending}
            aria-label="Monto del abono"
          />
          <small>Edita el monto para un abono parcial o déjalo igual para liquidar.</small>
        </label>

        <WorkshopPaymentMethodFields initialMethod="" disabled={pending} />

        <label>
          Notas
          <input name="payment_notes" placeholder="Opcional" />
        </label>

        <label>
          <input type="checkbox" name="payment_received" required disabled={pending} />
          Verifiqué que el dinero fue recibido.
        </label>
        <p>Puedes abonar o liquidar antes de la primera fecha del taller.</p>
        {state.error ? (
          <p className="profile360-workshop-payment-error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.paidMinor !== undefined && state.balanceMinor !== undefined ? (
          <p className="profile360-workshop-payment-success" role="status">
            Pago registrado. Saldo restante:{" "}
            {new Intl.NumberFormat(locale, { style: "currency", currency }).format(
              state.balanceMinor / 100,
            )}
          </p>
        ) : null}

        <button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar pago"}
        </button>
      </form>
    </details>
  );
}
