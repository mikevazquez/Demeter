"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { savePenaltyPolicyAction } from "./actions";

export type PenaltyPolicyValues = {
  packageLateCancellationPenaltyMinor: number;
  packageNoShowPenaltyMinor: number;
  pendingChargeBlocksBooking: boolean;
  noShow: { threshold: number | null; windowDays: number | null; blockDays: number | null };
  lateCancel: { threshold: number | null; windowDays: number | null; blockDays: number | null };
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="booking-rules-save" disabled={pending}>
      {pending ? "Guardando…" : "Guardar penalizaciones"}
    </button>
  );
}

function money(minor: number) {
  return minor ? (minor / 100).toFixed(2).replace(/\.00$/, "") : "";
}

function PauseRule({
  prefix,
  title,
  eventLabel,
  value,
}: {
  prefix: "no_show" | "late_cancel";
  title: string;
  eventLabel: string;
  value: PenaltyPolicyValues["noShow"];
}) {
  const [enabled, setEnabled] = useState(value.threshold !== null);
  return (
    <fieldset className="booking-rules-fieldset">
      <label className="booking-rules-check">
        <input
          type="checkbox"
          name={`${prefix}_block_enabled`}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>{title}</span>
      </label>
      {enabled ? (
        <div className="booking-rules-row is-three">
          <label className="booking-rules-field">
            <span>Después de</span>
            <div className="booking-rules-unit">
              <input
                name={`${prefix}_block_threshold`}
                type="number"
                min="1"
                max="20"
                inputMode="numeric"
                defaultValue={value.threshold ?? 3}
                required
              />
              <b>{eventLabel}</b>
            </div>
          </label>
          <label className="booking-rules-field">
            <span>En</span>
            <div className="booking-rules-unit">
              <input
                name={`${prefix}_block_window_days`}
                type="number"
                min="1"
                max="365"
                inputMode="numeric"
                defaultValue={value.windowDays ?? 30}
                required
              />
              <b>días</b>
            </div>
          </label>
          <label className="booking-rules-field">
            <span>No puede reservar por</span>
            <div className="booking-rules-unit">
              <input
                name={`${prefix}_block_days`}
                type="number"
                min="1"
                max="90"
                inputMode="numeric"
                defaultValue={value.blockDays ?? 7}
                required
              />
              <b>días</b>
            </div>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

// NEB-01-41 · Penalizaciones para alumnas regulares. Todo apagado por defecto.
export function PenaltyPolicyForm({
  values,
  currency,
}: {
  values: PenaltyPolicyValues;
  currency: string;
}) {
  return (
    <form action={savePenaltyPolicyAction} className="booking-rules-card">
      <header>
        <h2>Penalizaciones por faltas y cancelaciones tardías</h2>
        <p>
          Aplican a alumnas con paquete. La pausa se quita sola al vencer y recepción la puede
          quitar antes desde la ficha de la alumna.
        </p>
      </header>

      <PauseRule
        prefix="no_show"
        title="Pausar reservas por faltas (no-show)"
        eventLabel="faltas"
        value={values.noShow}
      />
      <PauseRule
        prefix="late_cancel"
        title="Pausar reservas por cancelaciones tardías"
        eventLabel="cancelaciones"
        value={values.lateCancel}
      />

      <div className="booking-rules-row">
        <label className="booking-rules-field">
          <span>Cargo por falta</span>
          <div className="booking-rules-unit">
            <input
              name="package_no_show_penalty"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={money(values.packageNoShowPenaltyMinor)}
              placeholder="0"
            />
            <b>{currency}</b>
          </div>
        </label>
        <label className="booking-rules-field">
          <span>Cargo por cancelación tardía</span>
          <div className="booking-rules-unit">
            <input
              name="package_late_cancellation_penalty"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={money(values.packageLateCancellationPenaltyMinor)}
              placeholder="0"
            />
            <b>{currency}</b>
          </div>
        </label>
        <small className="booking-rules-note">
          Además de gastar el crédito. 0 = sin cargo. Los ilimitados tienen su propio cargo arriba.
        </small>
      </div>

      <label className="booking-rules-check">
        <input
          type="checkbox"
          name="pending_charge_blocks_booking"
          defaultChecked={values.pendingChargeBlocksBooking}
        />
        <span>Un cargo pendiente no deja reservar hasta que se pague o se condone</span>
      </label>

      <SubmitButton />
    </form>
  );
}
