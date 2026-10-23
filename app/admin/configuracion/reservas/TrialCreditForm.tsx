"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { saveTrialCreditAction } from "./actions";

export type TrialCreditValues = {
  trialPriceMinor: number;
  creditEnabled: boolean;
  creditMinor: number;
  minEnrollmentMinor: number;
  validDays: number;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="booking-rules-save" disabled={pending}>
      {pending ? "Guardando…" : "Guardar primera clase"}
    </button>
  );
}

const major = (minor: number) => (minor / 100).toFixed(2).replace(/\.00$/, "");

// NEB-01-36 · Precio de la primera clase y abono a la inscripción.
export function TrialCreditForm({
  values,
  currency,
}: {
  values: TrialCreditValues;
  currency: string;
}) {
  const [enabled, setEnabled] = useState(values.creditEnabled);
  return (
    <form action={saveTrialCreditAction} className="booking-rules-card">
      <header>
        <h2>Primera clase</h2>
        <p>
          Cuánto cuesta la primera clase y si ese pago se abona a la inscripción cuando la alumna
          compra su paquete.
        </p>
      </header>

      <label className="booking-rules-field">
        <span>Precio de la primera clase</span>
        <div className="booking-rules-unit">
          <input
            name="trial_price"
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            defaultValue={major(values.trialPriceMinor)}
            required
          />
          <b>{currency}</b>
        </div>
        <small>Es lo que Demi cobra por adelantado cuando el estudio lo pide.</small>
      </label>

      <label className="booking-rules-check">
        <input
          type="checkbox"
          name="credit_enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Abonar el pago de la primera clase a la inscripción</span>
      </label>

      {enabled ? (
        <>
          <div className="booking-rules-row">
            <label className="booking-rules-field">
              <span>Se abona</span>
              <div className="booking-rules-unit">
                <input
                  name="credit_amount"
                  type="number"
                  min="1"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={major(values.creditMinor)}
                  required
                />
                <b>{currency}</b>
              </div>
            </label>
            <label className="booking-rules-field">
              <span>Si la inscripción cuesta al menos</span>
              <div className="booking-rules-unit">
                <input
                  name="min_enrollment"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={major(values.minEnrollmentMinor)}
                  required
                />
                <b>{currency}</b>
              </div>
            </label>
          </div>
          <label className="booking-rules-field">
            <span>Se puede usar hasta</span>
            <div className="booking-rules-unit">
              <input
                name="valid_days"
                type="number"
                min="0"
                max="30"
                inputMode="numeric"
                defaultValue={values.validDays}
                required
              />
              <b>días después de la clase</b>
            </div>
            <small>
              0 = solo el mismo día de la primera clase. Nunca se abona más de lo pagado.
            </small>
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="credit_amount" value={major(values.creditMinor)} />
          <input type="hidden" name="min_enrollment" value={major(values.minEnrollmentMinor)} />
          <input type="hidden" name="valid_days" value={values.validDays} />
        </>
      )}

      <SubmitButton />
    </form>
  );
}
