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

export function OperatingPolicyForm({
  cancellationCutoffMinutes,
  lateCancellationConsumesCredit,
  noShowConsumesCredit,
}: {
  cancellationCutoffMinutes: number;
  lateCancellationConsumesCredit: boolean;
  noShowConsumesCredit: boolean;
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
        <small>
          Después de este límite la reserva se considera cancelación tardía.
        </small>
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
        <small>Aplica a paquetes con créditos. No crea cargos monetarios para ilimitados.</small>
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

      <SubmitButton />
    </form>
  );
}
