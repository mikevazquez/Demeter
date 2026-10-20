"use client";

import { useActionState } from "react";

import { registerWorkshopPayment } from "./workshop-actions";

type Props = {
  purchaseId: string;
  studentId: string;
  balanceMinor: number;
  currency: string;
  locale: string;
};

export function WorkshopPaymentForm({
  purchaseId,
  studentId,
  balanceMinor,
  currency,
  locale,
}: Props) {
  const [state, action, pending] = useActionState(registerWorkshopPayment, { error: null });
  const balance = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(balanceMinor / 100);

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
      <form action={action}>
        <input type="hidden" name="purchase_id" value={purchaseId} />
        <input type="hidden" name="student_id" value={studentId} />

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
            defaultValue={(balanceMinor / 100).toFixed(2)}
            aria-label="Monto del abono"
          />
          <small>Edita el monto para un abono parcial o déjalo igual para liquidar.</small>
        </label>

        <label>
          Método
          <select name="payment_method" required defaultValue="">
            <option value="" disabled>
              Selecciona método
            </option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </label>

        <label>
          Referencia
          <input name="payment_reference" placeholder="Opcional" />
        </label>

        <label>
          Notas
          <input name="payment_notes" placeholder="Opcional" />
        </label>

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
