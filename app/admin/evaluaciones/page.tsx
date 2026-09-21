import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export default async function EvaluationsDashboardPage() {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const { data: evaluations } = await ctx.supabase
    .from("technical_evaluations")
    .select("id,status,final_outcome,total_score")
    .eq("studio_id", ctx.studio.id);

  const rows = evaluations ?? [];
  const drafts = rows.filter((item) => item.status === "draft");
  const published = rows.filter((item) => item.status === "published");
  const approved = published.filter((item) => item.final_outcome === "approved");
  const rate = published.length ? Math.round((approved.length / published.length) * 100) : 0;

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <h1>Evaluaciones</h1>
          <p>Desarrolla, mide y celebra su progreso técnico.</p>
        </div>
        {ctx.can(CAPABILITIES.EVALUATIONS_WRITE) ? (
          <Link className="eval-primary-button compact-mobile" href="/admin/evaluaciones/nueva">
            + Nueva evaluación
          </Link>
        ) : null}
      </header>

      <section className="eval-kpi-grid">
        <article className="eval-kpi-card">
          <span className="eval-kpi-icon">◫</span>
          <span className="eval-kpi-copy">
            <strong>{drafts.length}</strong>
            <span>Próximas evaluaciones</span>
            <small>Borradores activos</small>
          </span>
          <span className="eval-kpi-arrow">›</span>
        </article>
        <article className="eval-kpi-card">
          <span className="eval-kpi-icon">▤</span>
          <span className="eval-kpi-copy">
            <strong>{drafts.length}</strong>
            <span>Borradores</span>
            <small>Pendientes de publicar</small>
          </span>
          <span className="eval-kpi-arrow">›</span>
        </article>
        <article className="eval-kpi-card">
          <span className="eval-kpi-icon">✓</span>
          <span className="eval-kpi-copy">
            <strong>{published.length}</strong>
            <span>Evaluaciones realizadas</span>
            <small>Histórico</small>
          </span>
          <span className="eval-kpi-arrow">›</span>
        </article>
        <article className="eval-kpi-card">
          <span className="eval-kpi-icon">▥</span>
          <span className="eval-kpi-copy">
            <strong>{rate}%</strong>
            <span>Tasa de aprobación</span>
            <small>Evaluaciones publicadas</small>
          </span>
          <span className="eval-kpi-arrow">›</span>
        </article>
      </section>

      <nav className="eval-tabs">
        <Link className="is-active" href="/admin/evaluaciones">Resumen</Link>
        <Link href="/admin/evaluaciones/nueva">Nueva evaluación</Link>
        <Link href="/admin/evaluaciones/configuracion">Configuración</Link>
      </nav>

      <section className="eval-shortcuts">
        <Link className="eval-shortcut" href="/admin/evaluaciones/nueva">
          <span>＋</span><strong>Nueva evaluación</strong><small>Iniciar evaluación en vivo</small>
        </Link>
        <Link className="eval-shortcut" href="/admin/evaluaciones/configuracion">
          <span>▤</span><strong>Plantillas</strong><small>Criterios y niveles</small>
        </Link>
        <Link className="eval-shortcut" href="/admin/evaluaciones/configuracion#disciplinas">
          <span>◇</span><strong>Biblioteca técnica</strong><small>Figuras y combos</small>
        </Link>
        <Link className="eval-shortcut" href="/admin/evaluaciones?view=historial">
          <span>◷</span><strong>Historial</strong><small>Evaluaciones publicadas</small>
        </Link>
      </section>

      <section className="eval-panel">
        <header className="eval-panel-header">
          <h2>Actividad de evaluaciones</h2>
          <Link href="/admin/evaluaciones/nueva">Crear →</Link>
        </header>
        <div className="eval-empty">
          {rows.length
            ? "Los registros aparecerán aquí conforme avances en las evaluaciones."
            : "Todavía no hay evaluaciones. Configura una plantilla y crea la primera."}
        </div>
      </section>
    </main>
  );
}
