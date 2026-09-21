import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export default async function EvaluationsDashboardPage() {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone || "America/Mexico_City",
  }).format(new Date());

  const [disciplinesResult, linksResult, templatesResult, evaluationsResult] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name,active")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("discipline_technical_levels")
      .select("id,discipline_id,active")
      .eq("studio_id", ctx.studio.id),
    ctx.supabase
      .from("evaluation_templates")
      .select("id,discipline_id,archived_at")
      .eq("studio_id", ctx.studio.id),
    ctx.supabase
      .from("technical_evaluations")
      .select("id,discipline_id,evaluation_date,status")
      .eq("studio_id", ctx.studio.id)
      .eq("status", "draft")
      .gte("evaluation_date", today),
  ]);

  const disciplines = disciplinesResult.data ?? [];
  const links = linksResult.data ?? [];
  const templates = templatesResult.data ?? [];
  const evaluations = evaluationsResult.data ?? [];

  const enabledDisciplines = new Set(
    links.filter((link) => link.active).map((link) => link.discipline_id),
  );

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <h1>Evaluaciones</h1>
          <p>Elige una disciplina para consultar y configurar su evaluación técnica.</p>
        </div>
        {ctx.can(CAPABILITIES.EVALUATIONS_WRITE) ? (
          <Link className="eval-primary-button compact-mobile" href="/admin/evaluaciones/nueva">
            + Nueva evaluación
          </Link>
        ) : null}
      </header>

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>¿Qué disciplina quieres evaluar?</h2>
            <p>
              Cada disciplina tiene sus propios niveles, reglas, plantillas y próximas evaluaciones.
            </p>
          </div>
        </header>

        <div className="eval-discipline-grid">
          {disciplines.map((discipline) => {
            const enabled = enabledDisciplines.has(discipline.id);
            const levelCount = links.filter(
              (link) => link.discipline_id === discipline.id && link.active,
            ).length;
            const templateCount = templates.filter(
              (template) =>
                template.discipline_id === discipline.id && template.archived_at === null,
            ).length;
            const upcomingCount = evaluations.filter(
              (evaluation) => evaluation.discipline_id === discipline.id,
            ).length;

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
                  <small>
                    {enabled
                      ? `${levelCount} niveles · ${templateCount} plantillas · ${upcomingCount} próximas`
                      : "Configurar evaluación técnica"}
                  </small>
                </span>

                <span className={`eval-status ${enabled ? "approved" : ""}`}>
                  {enabled ? "Activa" : "Sin configurar"}
                </span>

                <span className="eval-kpi-arrow" aria-hidden="true">
                  ›
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
