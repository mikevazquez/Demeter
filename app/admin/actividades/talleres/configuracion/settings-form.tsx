"use client";
import { useActionState } from "react";
import { saveWorkshopDemiSettings } from "./settings-actions";
export function WorkshopDemiSettings({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(saveWorkshopDemiSettings, {
    error: null,
    saved: false,
  });
  return (
    <form action={action} className="activities-stage">
      <label>
        <input name="enabled" type="checkbox" defaultChecked={enabled} disabled={pending} />
        Permitir compras y seguimiento de talleres con Demi
      </label>
      <p>
        Demi muestra los talleres, explica las condiciones y solicita aceptación antes del
        comprobante. Los apartados son provisionales; el equipo siempre valida el ingreso.
      </p>
      <p>
        El seguimiento utiliza las preferencias de contacto y la cola existente. Fuera de la ventana
        de WhatsApp necesita plantillas aprobadas para continuidad y recordatorios de saldo en la
        configuración de seguimientos. Sin plantilla, el caso se revisa y no se envía a ciegas.
      </p>
      <p>
        La liberación automática solo aplica a compras cuya política guardada establece liberar
        después de la gracia. Las demás conservan sus reservas hasta una decisión explícita.
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.saved ? <p role="status">Configuración guardada.</p> : null}
      <button disabled={pending}>{pending ? "Guardando…" : "Guardar configuración"}</button>
    </form>
  );
}
