import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { prepareEvaluationDisciplineAction } from "./actions";

export default async function EvaluationsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const qs = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const [disciplinesResult, linksResult] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name,active")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("discipline_technical_levels")
      .select("discipline_id")
      .eq("studio_id", ctx.studio.id),
  ]);

  const disciplines = disciplinesResult.data ?? [];
  const configuredDisciplines = new Set(
    (linksResult.data ?? []).map((link) => link.discipline_id),
  );

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <h1>Evaluaciones</h1>
          <p>Elige una disciplina para configurar sus niveles técnicos.</p>
        </div>
        {ctx.can(CAPABILITIES.EVALUATIONS_WRITE) ? (
          <Link className="eval-primary-button compact-mobile" href="/admin/evaluaciones/nueva">
            + Nueva evaluación
          </Link>
        ) : null}
      </header>

      {qs.error ? (
        <div className="eval-notice">No pudimos abrir la disciplina. Inténtalo de nuevo.</div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>¿Qué disciplina quieres evaluar?</h2>
            <p>Cada disciplina tiene sus propios niveles y configuración técnica.</p>
          </div>
        </header>

        <div className="eval-discipline-grid">
          {disciplines.map((discipline) => {
            const configured = configuredDisciplines.has(discipline.id);

            if (configured) {
              return (
                <Link
                  className="eval-discipline-card"
                  href={`/admin/evaluaciones/disciplina/${discipline.id}`}
                  key={discipline.id}
                >
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ◇
                  </span>
                  <span className="eval-discipline-card-copy">
                    <strong>{discipline.name}</strong>
                    <small>Ver niveles</small>
                  </span>
                  <span className="eval-kpi-arrow" aria-hidden="true">
                    ›
                  </span>
                </Link>
              );
            }

            return (
              <form action={prepareEvaluationDisciplineAction} key={discipline.id}>
                <input type="hidden" name="discipline_id" value={discipline.id} />
                <button className="eval-discipline-card eval-discipline-card-button" type="submit">
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ◇
                  </span>
                  <span className="eval-discipline-card-copy">
                    <strong>{discipline.name}</strong>
                    <small>Configurar niveles</small>
                  </span>
                  <span className="eval-kpi-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      </section>
    </main>
  );
}
