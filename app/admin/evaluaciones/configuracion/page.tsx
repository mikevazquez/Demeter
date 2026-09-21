import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  enableEvaluationDiscipline,
  setEvaluationDisciplineActive,
} from "../actions";

const errorCopy: Record<string, string> = {
  discipline: "No pudimos actualizar la disciplina.",
};

export default async function EvaluationConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);

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
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>Configuración de evaluaciones</h1>
          <p>Configura cada disciplina de forma independiente.</p>
        </div>
      </header>

      {params.error ? (
        <div className="eval-notice">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>Disciplinas</h2>
            <p>
              Entra a una disciplina para administrar sus niveles, próximas evaluaciones y
              plantillas.
            </p>
          </div>
        </header>

        <div className="eval-discipline-list">
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
              <article className="eval-discipline-row eval-discipline-entry" key={discipline.id}>
                <span className="eval-discipline-icon" aria-hidden="true">
                  ◇
                </span>

                <span className="eval-discipline-copy">
                  <strong>{discipline.name}</strong>
                  <small>
                    {enabled
                      ? `${levelCount} niveles · ${templateCount} plantillas · ${upcomingCount} próximas`
                      : "Sin evaluación técnica"}
                  </small>
                </span>

                <span className={`eval-status ${enabled ? "approved" : ""}`}>
                  {enabled ? "Activa" : "Inactiva"}
                </span>

                {enabled ? (
                  <div className="eval-discipline-actions">
                    <Link
                      className="eval-primary-button"
                      href={`/admin/evaluaciones/configuracion/${discipline.id}`}
                    >
                      Configurar →
                    </Link>
                    <form action={setEvaluationDisciplineActive}>
                      <input type="hidden" name="discipline_id" value={discipline.id} />
                      <input type="hidden" name="active" value="false" />
                      <button className="eval-secondary-button" type="submit">
                        Desactivar
                      </button>
                    </form>
                  </div>
                ) : (
                  <form action={enableEvaluationDiscipline}>
                    <input type="hidden" name="discipline_id" value={discipline.id} />
                    <button className="eval-primary-button" type="submit">
                      Activar y configurar
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
