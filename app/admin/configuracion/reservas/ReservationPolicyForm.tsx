"use client";

import { useFormStatus } from "react-dom";

import { saveReservationPolicyAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="reservations-v2-save" disabled={pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </button>
  );
}

function minorToMajor(value: number) {
  return (value / 100).toFixed(2).replace(/\.00$/, "");
}

export function ReservationPolicyForm({
  cancellationCutoffMinutes,
  lateCancellationConsumesCredit,
  noShowConsumesCredit,
  unlimitedLateCancellationPenaltyMinor,
  unlimitedNoShowPenaltyMinor,
  currency,
}: {
  cancellationCutoffMinutes: number;
  lateCancellationConsumesCredit: boolean;
  noShowConsumesCredit: boolean;
  unlimitedLateCancellationPenaltyMinor: number;
  unlimitedNoShowPenaltyMinor: number;
  currency: string;
}) {
  return (
    <form action={saveReservationPolicyAction} className="reservations-v2-form">
      <section className="reservations-v2-card">
        <div className="reservations-v2-card-heading">
          <span className="reservations-v2-card-icon" aria-hidden="true">
            ↩
          </span>
          <div>
            <h2>Cancelaciones</h2>
            <p>Define hasta cuándo una alumna puede cancelar sin penalización.</p>
          </div>
        </div>

        <label className="reservations-v2-field">
          <span>Cancelar sin penalización hasta</span>
          <div className="reservations-v2-unit-input">
            <input
              name="cancellation_cutoff_hours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              defaultValue={cancellationCutoffMinutes / 60}
              required
            />
            <b>horas antes</b>
          </div>
          <small>Si cancela después de este límite, se considera cancelación tardía.</small>
        </label>

        <label className="reservations-v2-toggle">
          <span>
            <strong>Cancelación tardía consume crédito</strong>
            <small>Aplica a paquetes que usan créditos.</small>
          </span>
          <input
            name="late_cancellation_consumes_credit"
            type="checkbox"
            defaultChecked={lateCancellationConsumesCredit}
          />
        </label>
      </section>

      <section className="reservations-v2-card">
        <div className="reservations-v2-card-heading">
          <span className="reservations-v2-card-icon is-amber" aria-hidden="true">
            ○
          </span>
          <div>
            <h2>No-show</h2>
            <p>Qué pasa cuando alguien reserva y no asiste.</p>
          </div>
        </div>

        <label className="reservations-v2-toggle">
          <span>
            <strong>No-show consume crédito</strong>
            <small>El crédito se pierde cuando la asistencia queda marcada como no-show.</small>
          </span>
          <input
            name="no_show_consumes_credit"
            type="checkbox"
            defaultChecked={noShowConsumesCredit}
          />
        </label>
      </section>

      <section className="reservations-v2-card">
        <div className="reservations-v2-card-heading">
          <span className="reservations-v2-card-icon is-purple" aria-hidden="true">
            ∞
          </span>
          <div>
            <h2>Paquetes ilimitados</h2>
            <p>Como no usan créditos, puedes cobrar una penalización en su lugar.</p>
          </div>
        </div>

        <div className="reservations-v2-grid">
          <label className="reservations-v2-field">
            <span>Cancelación tardía</span>
            <div className="reservations-v2-money-input">
              <b>$</b>
              <input
                name="unlimited_late_cancellation_penalty"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                defaultValue={minorToMajor(unlimitedLateCancellationPenaltyMinor)}
                required
              />
              <em>{currency}</em>
            </div>
            <small>Usa 0 si no quieres generar cargo.</small>
          </label>

          <label className="reservations-v2-field">
            <span>No-show</span>
            <div className="reservations-v2-money-input">
              <b>$</b>
              <input
                name="unlimited_no_show_penalty"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                defaultValue={minorToMajor(unlimitedNoShowPenaltyMinor)}
                required
              />
              <em>{currency}</em>
            </div>
            <small>Usa 0 si no quieres generar cargo.</small>
          </label>
        </div>
      </section>

      <div className="reservations-v2-actions">
        <a href="/admin/configuracion" className="reservations-v2-secondary">
          Cancelar
        </a>
        <SubmitButton />
      </div>
    </form>
  );
}
