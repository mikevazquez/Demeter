import type { SupabaseClient } from "@supabase/supabase-js";

import { formatMinorMxn } from "@/lib/platform/console";
import { loadSupportTab, type SupportState } from "@/lib/platform/support";

import {
  endSupportSessionAction,
  startSupportSessionAction,
  updateSupportPackageAction,
} from "../../actions";

function timeMx(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateTimeIn(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** NEB-01-17 · Barra de soporte: entrar con motivo o, con sesión abierta, salir. */
export function SupportBar({ studioId, state }: { studioId: string; state: SupportState | null }) {
  if (!state) return null;
  if (state.active) {
    return (
      <section className="neb-card neb-support is-active" aria-label="Modo soporte">
        <div>
          <p className="neb-eyebrow">Modo soporte · hasta las {timeMx(state.expiresAt)}</p>
          <p>
            <strong>Motivo:</strong> {state.reason}
          </p>
          <p className="neb-muted">
            La dueña ve un aviso mientras estás dentro. Cada pestaña que abras y cada cambio quedan
            en la bitácora.
          </p>
        </div>
        <form action={endSupportSessionAction}>
          <input type="hidden" name="studio" value={studioId} />
          <button type="submit" className="neb-button is-ghost">
            Salir del estudio
          </button>
        </form>
      </section>
    );
  }
  return (
    <section className="neb-card neb-support" aria-label="Entrar como soporte">
      <h2>Entrar como soporte</h2>
      <p className="neb-muted">
        Abre Diagnóstico, Paquetes y Horario por 2 horas. Se avisa a la dueña y todo queda en la
        bitácora.
      </p>
      <form action={startSupportSessionAction} className="neb-form">
        <input type="hidden" name="studio" value={studioId} />
        <label>
          Motivo
          <input
            name="reason"
            required
            minLength={3}
            maxLength={200}
            placeholder="Ej. revisar precios a petición de la dueña"
          />
        </label>
        <button type="submit" className="neb-button">
          Entrar al estudio
        </button>
      </form>
    </section>
  );
}

/** Pestañas de soporte. Cada lectura queda registrada en la bitácora del estudio. */
export async function SupportTab({
  supabase,
  studioId,
  tab,
  timeZone,
}: {
  supabase: SupabaseClient;
  studioId: string;
  tab: "diagnostico" | "paquetes" | "horario";
  timeZone: string;
}) {
  const result = await loadSupportTab(supabase, studioId, tab);
  if (!result) {
    return <p className="neb-notice is-error">No se pudo leer. Entra de nuevo como soporte.</p>;
  }

  if (result.tab === "diagnostico") {
    const d = result.diagnostics;
    if (!d) return <p className="neb-muted">Sin datos.</p>;
    return (
      <section className="neb-kpis">
        <article className="neb-kpi">
          <span>Clases próximos 7 días</span>
          <strong>{d.classesNext7Days}</strong>
          <small>{d.classesWithoutReservations7Days} sin reservas</small>
        </article>
        <article className="neb-kpi">
          <span>Reservas próximos 7 días</span>
          <strong>{d.reservationsNext7Days}</strong>
        </article>
        <article className="neb-kpi">
          <span>Ventas con fecha de pago</span>
          <strong>{d.salesWithDueDate}</strong>
          <small>Por cobrar</small>
        </article>
        <article className="neb-kpi">
          <span>Paquetes</span>
          <strong>{d.productsActive}</strong>
          <small>{d.productsInactive} inactivos</small>
        </article>
      </section>
    );
  }

  if (result.tab === "paquetes") {
    if (!result.packages.length) return <p className="neb-muted">El estudio no tiene paquetes.</p>;
    return (
      <ul className="neb-module-list">
        {result.packages.map((pkg) => (
          <li key={pkg.id}>
            <form action={updateSupportPackageAction} className="neb-form">
              <input type="hidden" name="studio" value={studioId} />
              <input type="hidden" name="product" value={pkg.id} />
              <p className="neb-muted">
                {pkg.productType}
                {pkg.unlimited
                  ? " · ilimitado"
                  : pkg.creditLimit
                    ? ` · ${pkg.creditLimit} clases`
                    : ""}
                {pkg.validityDays ? ` · ${pkg.validityDays} días` : ""} · ahora{" "}
                {formatMinorMxn(pkg.priceMinor)}
              </p>
              <label>
                Nombre
                <input name="name" defaultValue={pkg.name} required minLength={2} maxLength={120} />
              </label>
              <label>
                Precio (MXN)
                <input
                  name="price"
                  inputMode="decimal"
                  defaultValue={(pkg.priceMinor / 100).toFixed(2)}
                  required
                />
              </label>
              <label>
                <input type="checkbox" name="active" defaultChecked={pkg.active} /> Activo
              </label>
              <button type="submit" className="neb-button is-ghost">
                Guardar
              </button>
            </form>
          </li>
        ))}
      </ul>
    );
  }

  if (!result.schedule.length) return <p className="neb-muted">Sin clases en los próximos 14 días.</p>;
  return (
    <ol className="neb-audit">
      {result.schedule.map((item) => (
        <li key={item.id}>
          <time dateTime={item.startsAt}>{dateTimeIn(item.startsAt, timeZone)}</time>
          <span>
            {item.className} · {item.reserved}/{item.capacity}
            {item.status !== "scheduled" ? ` · ${item.status}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

