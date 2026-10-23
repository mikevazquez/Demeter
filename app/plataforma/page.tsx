import Link from "next/link";

import { formatMxn } from "@/lib/platform/catalog";
import {
  STATUS_LABEL,
  formatDateMx,
  loadPlatformOverview,
  loadPlatformStudios,
} from "@/lib/platform/console";
import { createClient } from "@/lib/supabase/server";

// NEB-01-10 · Inicio: cuánto entra al mes, cuántos estudios y qué necesita atención.
export default async function PlataformaInicioPage() {
  const supabase = await createClient("admin");
  const [overview, studios] = await Promise.all([
    loadPlatformOverview(supabase),
    loadPlatformStudios(supabase),
  ]);

  if (!overview || !studios) {
    return (
      <section className="neb-card neb-empty" role="status">
        <h1>La consola todavía no tiene datos</h1>
        <p>
          Falta aplicar la migración de lecturas de la consola (NEB-01-10) en este ambiente, o la
          base no respondió. Vuelve a intentar en un momento.
        </p>
      </section>
    );
  }

  const attention =
    (overview.studiosByStatus.grace ?? 0) +
    (overview.studiosByStatus.read_only ?? 0) +
    (overview.studiosByStatus.suspended ?? 0);

  return (
    <>
      <section className="neb-hero">
        <p className="neb-eyebrow">Inicio</p>
        <h1>Así va Nébora</h1>
      </section>

      <section className="neb-kpis" aria-label="Métricas">
        <article className="neb-kpi">
          <span>Ingreso mensual</span>
          <strong>{formatMxn(overview.mrrMxn)}</strong>
          <small>estudios activos y en gracia</small>
        </article>
        <article className="neb-kpi">
          <span>Estudios</span>
          <strong>{overview.studiosTotal}</strong>
          <small>
            {overview.studiosByStatus.active ?? 0} activos · {overview.studiosByStatus.internal ?? 0}{" "}
            internos
          </small>
        </article>
        <article className="neb-kpi">
          <span>Founding</span>
          <strong>
            {overview.foundingUsed} de {overview.foundingSeats}
          </strong>
          <small>lugares usados</small>
        </article>
        <article className="neb-kpi">
          <span>Alumnas activas</span>
          <strong>{overview.studiosActiveStudents}</strong>
          <small>en todos los estudios</small>
        </article>
        <article className={`neb-kpi${attention > 0 ? " is-warn" : ""}`}>
          <span>Pagos con atraso</span>
          <strong>{attention}</strong>
          <small>en gracia, solo lectura o suspendidos</small>
        </article>
        <article className={`neb-kpi${overview.pendingRequests > 0 ? " is-accent" : ""}`}>
          <span>Módulos pedidos</span>
          <strong>{overview.pendingRequests}</strong>
          <small>esperando activación</small>
        </article>
      </section>

      <section id="estudios" className="neb-section">
        <h2>Estudios</h2>
        {studios.length === 0 ? (
          <p className="neb-muted">Todavía no hay estudios.</p>
        ) : (
          <ul className="neb-studio-list">
            {studios.map((studio) => (
              <li key={studio.id}>
                <Link href={`/plataforma/estudios/${studio.id}`} className="neb-studio-row">
                  <div className="neb-studio-name">
                    <strong>{studio.brandName}</strong>
                    <small>{studio.slug ? `${studio.slug}.nebora.mx` : studio.name}</small>
                  </div>
                  <div className="neb-studio-meta">
                    <span className={`neb-pill is-${studio.status}`}>
                      {STATUS_LABEL[studio.status] ?? studio.status}
                    </span>
                    <span className="neb-pill">
                      {studio.planLabel}
                      {studio.foundingMonth ? ` · mes ${studio.foundingMonth} de 12` : ""}
                    </span>
                    {studio.pendingRequests > 0 ? (
                      <span className="neb-pill is-accent">
                        {studio.pendingRequests} pedido{studio.pendingRequests === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <dl className="neb-studio-numbers">
                    <div>
                      <dt>Mensualidad</dt>
                      <dd>{formatMxn(studio.monthlyPriceMxn)}</dd>
                    </div>
                    <div>
                      <dt>Alumnas</dt>
                      <dd>{studio.studentsActive}</dd>
                    </div>
                    <div>
                      <dt>Corte</dt>
                      <dd>{studio.nextCutOn ? formatDateMx(studio.nextCutOn) : "—"}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
