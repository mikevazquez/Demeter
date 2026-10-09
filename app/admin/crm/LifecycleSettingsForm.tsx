"use client";
import { useActionState } from "react";
import { saveInactivityDays } from "./actions";

export default function LifecycleSettingsForm({ days }: { days: number }) {
  const [result, action, pending] = useActionState(saveInactivityDays, {});
  return (
    <form action={action} className="crm-followup">
      <label>
        Días sin paquete activo
        <input
          name="inactivity_days"
          type="number"
          min={1}
          max={365}
          required
          defaultValue={days}
        />
      </label>
      <p className="crm-help">
        Cuando una alumna regular completa este plazo sin paquete activo, su tipo en el CRM pasa a
        Exalumna. Se registra en Actividad; el expediente operativo, sus saldos y el acceso de la
        alumna no cambian.
      </p>
      <button className="crm-primary" type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar plazo"}
      </button>
      {result.saved && <p role="status">Plazo guardado.</p>}
      {result.error && <p role="alert">{result.error}</p>}
    </form>
  );
}
