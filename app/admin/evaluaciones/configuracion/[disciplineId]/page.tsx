import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  createEvaluationTemplate,
  setEvaluationDisciplineActive,
  setEvaluationDisciplineLevelActive,
} from "../../actions";

type View = "resumen" | "niveles" | "proximas" | "plantillas";

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { day: "—", month: "" };
  return {
    day: new Intl.DateTimeFormat("es-MX", { day: "numeric" }).format(date),
    month: new Intl.DateTimeFormat("es-MX", { month: "short" })
      .format(date)
      .replace(".", "")
      .toUpperCase(),
  };
}

export default async function EvaluationDisciplineConfigurationPage({
  params,
  searchParams,
}: {
  params: Promise<{ disciplineId: string }>;
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const { disciplineId } = await params;
  const qs = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);

  const view: View =
    qs.view === "niveles" || qs.view === "proximas" || qs.view === "plantillas"
      ? qs.view
      : "resumen";

  const { data: discipline } = await ctx.supabase
    .from("disciplines")
    .select("id,name,active")
    .eq("id", disciplineId)
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .maybeSingle();

  if (!discipline) notFound();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone || "America/Mexico_City",
  }).format(new Date());

  const [linksResult, definitionsResult, templatesResult, evaluationsResult] = await Promise.all([
    ctx.supabase
      .from("discipline_technical_levels")
      .select("id,technical_level_id,discipline_order,active")
      .eq("studio_id", ctx.studio.id)
      .eq("discipline_id", discipline.id)
      .order("discipline_order"),
    ctx.supabase
      .from("technical_level_definitions")
      .select("id,title,level_order,active")
      .eq("studio_id", ctx.studio.id)
      .order("level_order"),
    ctx.supabase
      .from("evaluation_templates")
      .select(
        "id,name,discipline_technical_level_id,updated_at,archived_at",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("discipline_id", discipline.id)
      .order("updated_at", { ascending: false }),
    ctx.supabase
      .from("technical_evaluations")
      .select(
        "id,student_name_snapshot,target_discipline_level_id,evaluation_date,status,total_score,final_outcome",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("discipline_id", discipline.id)
      .eq("status", "draft")
      .gte("evaluation_date", today)
      .order("evaluation_date", { ascending: true }),
  ]);

  const links = linksResult.data ?? [];
  const definitions = definitionsResult.data ?? [];
  const templates = templatesResult.data ?? [];
  const upcoming = evaluationsResult.data ?? [];

  const definitionById = new Map(definitions.map((level) => [level.id, level]));
  const levelTitleByLinkId = new Map(
    links.map((link) => [
      link.id,
      definitionById.get(link.technical_level_id)?.title ?? "Nivel técnico",
    ]),
  );

  const templateIds = templates.map((template) => template.id);
  const versionsResult = templateIds.length
    ? await ctx.supabase
        .from("evaluation_template_versions")
        .select("id,template_id,version_number,status,pass_threshold,default_category_min")
        .in("template_id", templateIds)
        .order("version_number", { ascending: false })
    : { data: [] };

  const latestVersion = new Map<
    string,
    {
      id: string;
      template_id: string;
      version_number: number;
      status: string;
      pass_threshold: number;
      default_category_min: number;
    }
  >();

  for (const version of versionsResult.data ?? []) {
    if (!latestVersion.has(version.template_id)) {
      latestVersion.set(version.template_id, version);
    }
  }

  const activeLevels = links.filter((link) => link.active);
  const activeTemplates = templates.filter((template) => template.archived_at === null);
  const activeVersions = activeTemplates.filter(
    (template) => latestVersion.get(template.id)?.status === "active",
  ).length;

  const errorCopy: Record<string, string> = {
    level: "No pudimos actualizar el nivel técnico.",
    template: "No pudimos crear la plantilla.",
  };

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones/configuracion">
            ← Disciplinas
          </Link>
          <h1>{discipline.name}</h1>
          <p>Configuración técnica de esta disciplina.</p>
        </div>
        <form action={setEvaluationDisciplineActive}>
          <input type="hidden" name="discipline_id" value={discipline.id} />
          <input type="hidden" name="active" value="false" />
          <button className="eval-secondary-button" type="submit">
            Desactivar
          </button>
        </form>
      </header>

      {qs.error ? (
        <div className="eval-notice">
          {errorCopy[qs.error] ?? "No pudimos completar la acción."}
        </div>
      ) : null}

      <nav className="eval-tabs" aria-label={`Configuración de ${discipline.name}`}>
        <Link
          className={view === "resumen" ? "is-active" : ""}
          href={`/admin/evaluaciones/configuracion/${discipline.id}`}
        >
          Resumen
        </Link>
        <Link
          className={view === "niveles" ? "is-active" : ""}
          href={`/admin/evaluaciones/configuracion/${discipline.id}?view=niveles`}
        >
          Niveles
        </Link>
        <Link
          className={view === "proximas" ? "is-active" : ""}
          href={`/admin/evaluaciones/configuracion/${discipline.id}?view=proximas`}
        >
          Próximas evaluaciones
        </Link>
        <Link
          className={view === "plantillas" ? "is-active" : ""}
          href={`/admin/evaluaciones/configuracion/${discipline.id}?view=plantillas`}
        >
          Plantillas
        </Link>
      </nav>

      {view === "resumen" ? (
        <>
          <section className="eval-kpi-grid">
            <Link
              className="eval-kpi-card"
              href={`/admin/evaluaciones/configuracion/${discipline.id}?view=niveles`}
            >
              <span className="eval-kpi-icon" aria-hidden="true">
                ▥
              </span>
              <span className="eval-kpi-copy">
                <strong>{activeLevels.length}</strong>
                <span>Niveles activos</span>
                <small>De {links.length} configurados</small>
              </span>
              <span className="eval-kpi-arrow">›</span>
            </Link>

            <Link
              className="eval-kpi-card"
              href={`/admin/evaluaciones/configuracion/${discipline.id}?view=plantillas`}
            >
              <span className="eval-kpi-icon" aria-hidden="true">
                ▤
              </span>
              <span className="eval-kpi-copy">
                <strong>{activeTemplates.length}</strong>
                <span>Plantillas</span>
                <small>{activeVersions} activas</small>
              </span>
              <span className="eval-kpi-arrow">›</span>
            </Link>

            <Link
              className="eval-kpi-card"
              href={`/admin/evaluaciones/configuracion/${discipline.id}?view=proximas`}
            >
              <span className="eval-kpi-icon" aria-hidden="true">
                ◫
              </span>
              <span className="eval-kpi-copy">
                <strong>{upcoming.length}</strong>
                <span>Próximas evaluaciones</span>
                <small>Programadas</small>
              </span>
              <span className="eval-kpi-arrow">›</span>
            </Link>

            <article className="eval-kpi-card">
              <span className="eval-kpi-icon" aria-hidden="true">
                ✓
              </span>
              <span className="eval-kpi-copy">
                <strong>{activeVersions}</strong>
                <span>Listas para usar</span>
                <small>Plantillas activas</small>
              </span>
              <span className="eval-kpi-arrow">›</span>
            </article>
          </section>

          <section className="eval-panel eval-config-section">
            <header>
              <div>
                <h2>Configuración de {discipline.name}</h2>
                <p>
                  Los requisitos de esta disciplina se definen por nivel dentro de sus plantillas
                  de evaluación.
                </p>
              </div>
            </header>

            <div className="eval-shortcuts">
              <Link
                className="eval-shortcut"
                href={`/admin/evaluaciones/configuracion/${discipline.id}?view=niveles`}
              >
                <span aria-hidden="true">▥</span>
                <strong>Niveles</strong>
                <small>Activa sólo los niveles que aplican a esta disciplina.</small>
              </Link>
              <Link
                className="eval-shortcut"
                href={`/admin/evaluaciones/configuracion/${discipline.id}?view=plantillas`}
              >
                <span aria-hidden="true">▤</span>
                <strong>Plantillas</strong>
                <small>Define criterios, figuras, combos y reglas por nivel.</small>
              </Link>
              <Link
                className="eval-shortcut"
                href={`/admin/evaluaciones/configuracion/${discipline.id}?view=proximas`}
              >
                <span aria-hidden="true">◷</span>
                <strong>Próximas evaluaciones</strong>
                <small>Consulta qué alumnas serán evaluadas en esta disciplina.</small>
              </Link>
              <Link className="eval-shortcut" href="/admin/evaluaciones/nueva">
                <span aria-hidden="true">＋</span>
                <strong>Nueva evaluación</strong>
                <small>Inicia una evaluación usando una plantilla activa.</small>
              </Link>
            </div>
          </section>
        </>
      ) : null}

      {view === "niveles" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Niveles de {discipline.name}</h2>
              <p>
                Cada disciplina puede usar una combinación distinta de niveles y requisitos.
              </p>
            </div>
          </header>

          <div className="eval-discipline-list">
            {links.map((link) => {
              const definition = definitionById.get(link.technical_level_id);
              const levelTemplates = templates.filter(
                (template) => template.discipline_technical_level_id === link.id,
              );

              return (
                <article className="eval-discipline-row" key={link.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    {link.discipline_order}
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{definition?.title ?? "Nivel técnico"}</strong>
                    <small>
                      {levelTemplates.length
                        ? `${levelTemplates.length} plantilla${levelTemplates.length === 1 ? "" : "s"}`
                        : "Sin plantilla todavía"}
                    </small>
                  </span>
                  <span className={`eval-status ${link.active ? "approved" : ""}`}>
                    {link.active ? "Activo" : "Inactivo"}
                  </span>
                  <form action={setEvaluationDisciplineLevelActive}>
                    <input type="hidden" name="discipline_id" value={discipline.id} />
                    <input type="hidden" name="discipline_level_id" value={link.id} />
                    <input type="hidden" name="active" value={link.active ? "false" : "true"} />
                    <button className="eval-secondary-button" type="submit">
                      {link.active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {view === "proximas" ? (
        <section className="eval-panel">
          <header className="eval-panel-header">
            <h2>Próximas evaluaciones · {discipline.name}</h2>
            <Link href="/admin/evaluaciones/nueva">Nueva →</Link>
          </header>

          {upcoming.length ? (
            <div className="eval-list">
              {upcoming.map((evaluation) => {
                const date = dateParts(evaluation.evaluation_date);
                return (
                  <Link
                    className="eval-list-row"
                    href={`/admin/evaluaciones/${evaluation.id}`}
                    key={evaluation.id}
                  >
                    <span className="eval-date-box">
                      <small>{date.month}</small>
                      <strong>{date.day}</strong>
                    </span>
                    <span className="eval-row-copy">
                      <strong>{evaluation.student_name_snapshot}</strong>
                      <small>
                        {levelTitleByLinkId.get(evaluation.target_discipline_level_id) ??
                          "Nivel técnico"}
                      </small>
                    </span>
                    <span className="eval-status">Programada</span>
                    <span aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="eval-empty">
              No hay evaluaciones próximas de {discipline.name}.
            </div>
          )}
        </section>
      ) : null}

      {view === "plantillas" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Plantillas de evaluación</h2>
              <p>
                Cada nivel de {discipline.name} puede tener criterios, figuras, combos y reglas
                propias.
              </p>
            </div>
          </header>

          {activeLevels.length ? (
            <form action={createEvaluationTemplate} className="eval-form">
              <input type="hidden" name="discipline_id" value={discipline.id} />
              <div className="eval-field-grid">
                <div className="eval-field">
                  <label htmlFor="template-name">Nombre de plantilla</label>
                  <input
                    id="template-name"
                    name="name"
                    placeholder={`${discipline.name} · Intermedio`}
                    required
                    minLength={2}
                  />
                </div>

                <div className="eval-field">
                  <label htmlFor="discipline-level">Nivel técnico</label>
                  <select id="discipline-level" name="discipline_level_id" required defaultValue="">
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {activeLevels.map((link) => (
                      <option key={link.id} value={link.id}>
                        {levelTitleByLinkId.get(link.id) ?? "Nivel técnico"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="eval-form-actions">
                <button className="eval-primary-button" type="submit">
                  + Nueva plantilla
                </button>
              </div>
            </form>
          ) : (
            <div className="eval-empty">
              Activa al menos un nivel de {discipline.name} antes de crear una plantilla.
            </div>
          )}

          {activeTemplates.length ? (
            <div className="eval-template-grid" style={{ marginTop: 14 }}>
              {activeTemplates.map((template) => {
                const version = latestVersion.get(template.id);
                return (
                  <Link
                    className="eval-template-card"
                    key={template.id}
                    href={`/admin/evaluaciones/plantillas/${template.id}`}
                  >
                    <header>
                      <h3>{template.name}</h3>
                      <span
                        className={`eval-status ${version?.status === "active" ? "approved" : ""}`}
                      >
                        {version?.status === "active"
                          ? "Activa"
                          : version?.status === "archived"
                            ? "Archivada"
                            : "Borrador"}
                      </span>
                    </header>

                    <p>
                      {levelTitleByLinkId.get(template.discipline_technical_level_id) ??
                        "Nivel técnico"}
                    </p>

                    <span className="eval-template-meta">
                      v{version?.version_number ?? 1} ·{" "}
                      {version
                        ? `${version.pass_threshold}% global · ${version.default_category_min}% mínimo`
                        : "Configurar"}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="eval-empty" style={{ marginTop: 14 }}>
              Todavía no hay plantillas para {discipline.name}.
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
