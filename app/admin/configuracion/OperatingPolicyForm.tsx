"use client";

import { useFormStatus } from "react-dom";

import { saveStudioOperatingPolicyAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar política"}
    </button>
  );
}

function minorToMajor(value: number) {
  return (value / 100).toFixed(2).replace(/\.00$/, "");
}

export function OperatingPolicyForm({
  cancellationCutoffMinutes,
  lateCancellationConsumesCredit,
  noShowConsumesCredit,
  defaultMinimumReservationsEnabled,
  defaultMinimumReservations,
  defaultMinimumReviewMinutesBefore,
  defaultMinimumOverrideAllowed,
  unlimitedLateCancellationPenaltyMinor,
  unlimitedNoShowPenaltyMinor,
  currency,
}: {
  cancellationCutoffMinutes: number;
  lateCancellationConsumesCredit: boolean;
  noShowConsumesCredit: boolean;
  defaultMinimumReservationsEnabled: boolean;
  defaultMinimumReservations: number;
  defaultMinimumReviewMinutesBefore: number;
  defaultMinimumOverrideAllowed: boolean;
  unlimitedLateCancellationPenaltyMinor: number;
  unlimitedNoShowPenaltyMinor: number;
  currency: string;
}) {
  return (
    <form action={saveStudioOperatingPolicyAction} className="panel branding-config-form">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">POLÍTICA OPERATIVA</p>
          <h2>Reservas, cancelaciones y no-show</h2>
        </div>
      </div>

      <label className="branding-field">
        <span>Horas para cancelar a tiempo</span>
        <input
          name="cancellation_cutoff_hours"
          type="number"
          min="0"
          max="168"
          step="0.5"
          defaultValue={cancellationCutoffMinutes / 60}
          required
        />
        <small>Después de este límite la reserva se considera cancelación tardía.</small>
      </label>

      <label className="branding-field">
        <span>
          <input
            name="late_cancellation_consumes_credit"
            type="checkbox"
            defaultChecked={lateCancellationConsumesCredit}
          />{" "}
          Las cancelaciones tardías consumen el crédito
        </span>
        <small>Aplica a paquetes con créditos.</small>
      </label>

      <label className="branding-field">
        <span>
          <input
            name="no_show_consumes_credit"
            type="checkbox"
            defaultChecked={noShowConsumesCredit}
          />{" "}
          Los no-show consumen el crédito
        </span>
        <small>Aplica a paquetes con créditos cuando se finaliza la asistencia.</small>
      </label>

      <div className="branding-field">
        <span>Penalizaciones para paquetes ilimitados</span>
        <div className="branding-config-form">
          <label className="branding-field">
            <span>Cancelación tardía ({currency})</span>
            <input
              name="unlimited_late_cancellation_penalty"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue={minorToMajor(unlimitedLateCancellationPenaltyMinor)}
              required
            />
          </label>
          <label className="branding-field">
            <span>No-show ({currency})</span>
            <input
              name="unlimited_no_show_penalty"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue={minorToMajor(unlimitedNoShowPenaltyMinor)}
              required
            />
          </label>
        </div>
        <small>
          Studio Flow crea un cargo pendiente cuando una reserva ilimitada cae en uno de estos
          estados. Usa 0 para no generar cargo.
        </small>
      </div>

      <div className="panel-heading">
        <div>
          <p className="eyebrow">DEFAULTS DE ACTIVIDADES</p>
          <h2>Mínimo de reservas</h2>
        </div>
      </div>

      <label className="branding-field">
        <span>
          <input
            name="default_minimum_reservations_enabled"
            type="checkbox"
            defaultChecked={defaultMinimumReservationsEnabled}
          />{" "}
          Activar por defecto en actividades nuevas
        </span>
        <small>
          Cada actividad puede cambiar esta regla después. No modifica actividades existentes.
        </small>
      </label>

      <label className="branding-field">
        <span>Mínimo de reservas predeterminado</span>
        <input
          name="default_minimum_reservations"
          type="number"
          min="1"
          max="100"
          step="1"
          defaultValue={defaultMinimumReservations}
          required
        />
      </label>

      <label className="branding-field">
        <span>Revisar cuántas horas antes</span>
        <input
          name="default_minimum_review_hours"
          type="number"
          min="0.25"
          max="168"
          step="0.25"
          defaultValue={defaultMinimumReviewMinutesBefore / 60}
          required
        />
        <small>La revisión debe quedar entre 15 minutos y 7 días antes de la clase.</small>
      </label>

      <label className="branding-field">
        <span>
          <input
            name="default_minimum_override_allowed"
            type="checkbox"
            defaultChecked={defaultMinimumOverrideAllowed}
          />{" "}
          Permitir “Impartir aunque no alcance”
        </span>
        <small>Define el valor inicial para actividades nuevas.</small>
      </label>

      <SubmitButton />
    </form>
  );
}
