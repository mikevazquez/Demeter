"use client";

import { useFormStatus } from "react-dom";

import { recordPendingClassPaymentAndAttendanceFromToday } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="today-payment-confirm" type="submit" disabled={pending}>
      {pending ? "Registrando…" : "Registrar pago y asistencia"}
    </button>
  );
}

export function PendingClassPaymentDialog({
  reservationId,
  sessionId,
  returnDate,
  returnTo,
  studentName,
  amountMinor,
  onClose,
}: {
  reservationId: string;
  sessionId: string;
  returnDate: string;
  returnTo?: string;
  studentName: string;
  amountMinor?: number | null;
  currency: string;
  onClose: () => void;
}) {
  const configuredAmount = typeof amountMinor === "number" && amountMinor > 0;

  return (
    <div
      className="today-payment-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="today-payment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-class-payment-title"
      >
        <header>
          <div>
            <span className="today-payment-eyebrow">PAGO PENDIENTE</span>
            <h3 id="pending-class-payment-title">Cobrar y registrar asistencia</h3>
            <p>{studentName} · Primero se registra el pago y luego la asistencia.</p>
          </div>
          <button
            type="button"
            className="today-payment-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <form action={recordPendingClassPaymentAndAttendanceFromToday}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="reservation_id" value={reservationId} />
          <input type="hidden" name="return_date" value={returnDate} />
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

          <div className="today-payment-amount">
            <span>Importe</span>
            <label>
              <span>Monto cobrado</span>
              <input
                name="payment_amount"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={configuredAmount ? (amountMinor / 100).toFixed(2) : ""}
                required
              />
            </label>
          </div>

          <label className="today-payment-field">
            <span>¿Cómo pagó?</span>
            <select name="payment_method" required defaultValue="">
              <option value="" disabled>
                Seleccionar método
              </option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </label>

          <label className="today-payment-field">
            <span>Referencia</span>
            <input name="payment_reference" maxLength={120} placeholder="Opcional" />
          </label>

          <div className="today-payment-actions">
            <button type="button" className="today-payment-cancel" onClick={onClose}>
              Cancelar
            </button>
            <SubmitButton />
          </div>
        </form>
      </section>
    </div>
  );
}
