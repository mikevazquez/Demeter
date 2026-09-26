"use client";

import { useFormStatus } from "react-dom";

import { recordPendingClassPaymentAndAttendanceFromToday } from "../actions";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
  }).format(value / 100);
}

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
  currency,
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
            <h3 id="pending-class-payment-title">Registrar pago de la clase</h3>
            <p>
              {studentName} llegó desde Asistian sin pago registrado. El cobro y la asistencia se
              guardarán juntos.
            </p>
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
            {configuredAmount ? (
              <>
                <strong>{money(amountMinor, currency)}</strong>
                <input type="hidden" name="payment_amount" value={(amountMinor / 100).toFixed(2)} />
              </>
            ) : (
              <label>
                <span>Monto cobrado</span>
                <div>
                  <b>$</b>
                  <input
                    name="payment_amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                    autoFocus
                  />
                </div>
              </label>
            )}
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
