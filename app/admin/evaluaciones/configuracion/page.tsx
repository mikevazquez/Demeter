import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  createEvaluationTemplate,
  enableEvaluationDiscipline,
  setEvaluationDisciplineActive,
} from "../actions";

const errorCopy: Record<string, string> = {
  discipline: "No pudimos actualizar la disciplina.",
  template: "No pudimos crear la plantilla.",
};

export default async function EvaluationConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);

  const [disciplinesResult, levelDefsResult, linksResult, templatesResult] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id,name,active")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("technical_level_definitions")
      .select("id,level_key,title,level_order,active")
      .eq("studio_id", ctx.studio.id)
      .order("level_order"),
    ctx.supabase
      .from("discipline_technical_levels")
      .select("id,discipline_id,technical_level_id,discipline_order,active")
      .eq("studio_id", ctx.studio.id)
      .order("discipline_order"),
    ctx.supabase
      .from("evaluation_templates")
      .select("id,name,discipline_id,discipline_technical_level_id,updated_at,archived_at")
      .eq("studio_id", ctx.studio.id)
      .order("updated_at", { ascending: false }),
  ]);

  const disciplines = disciplinesResult.data ?? [];
  const levelDefs = levelDefsResult.data ?? [];
  const links = linksResult.data ?? [];
  const templates = templatesResult.data ?? [];
  const levelById = new Map(levelDefs.map((level) => [level.id, level]));
  const disciplineById = new Map(disciplines.map((discipline) => [discipline.id, discipline]));

  const templateIds = templates.map((template) => template.id);
  const versionsResult = templateIds.length
    ? await ctx.supabase
        .from("evaluation_template_versions")
        .select("id,template_id,version_number,status")
        .in("template_id", templateIds)
        .order("version_number", { ascending: false })
    : { data: [] };

  const latestVersion = new Map<string, { id: string; version_number: number; status: string }>();
  for (const version of versionsResult.data ?? []) {
    if (!latestVersion.has(version.template_id)) {
      latestVersion.set(version.template_id, version);
    }
  }

  const enabledDisciplines = new Set(
    links.filter((link) => link.active).map((link) => link.discipline_id),
  );
  const activeLinks = links.filter((link) => link.active);

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>Configuración de evaluaciones</h1>
          <p>Administra disciplinas, niveles y reglas técnicas.</p>
        </div>
      </header>
      {params.error ? (
        <div className="eval-notice">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <nav className="eval-tabs" aria-label="Configuración de evaluaciones">
        <a className="is-active" href="#disciplinas">
          Disciplinas
        </a>
        <a href="#niveles">Niveles</a>
        <a href="#reglas">Reglas</a>
        <a href="#plantillas">Plantillas</a>
      </nav>

      <div className="eval-config-grid">
        <section className="eval-panel eval-config-section" id="disciplinas">
          <header>
            <div>
              <h2>Disciplinas evaluadas</h2>
              <p>Activa solamente las disciplinas donde usarás nivel técnico.</p>
            </div>
          </header>

          <div className="eval-discipline-list">
            {disciplines.map((discipline) => {
              const enabled = enabledDisciplines.has(discipline.id);
              const disciplineLinks = links.filter(
                (link) => link.discipline_id === discipline.id && link.active,
              );

              return (
                <article className="eval-discipline-row" key={discipline.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ◇
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{discipline.name}</strong>
                    <small>
                      {enabled
                        ? `${disciplineLinks.length} niveles técnicos activos`
                        : "Sin evaluación técnica"}
                    </small>
                  </span>
                  <span className={`eval-status ${enabled ? "approved" : ""}`}>
                    {enabled ? "Activa" : "Inactiva"}
                  </span>
                  {enabled ? (
                    <form action={setEvaluationDisciplineActive}>
                      <input type="hidden" name="discipline_id" value={discipline.id} />
                      <input type="hidden" name="active" value="false" />
                      <button className="eval-secondary-button" type="submit">
                        Desactivar
                      </button>
                    </form>
                  ) : (
                    <form action={enableEvaluationDiscipline}>
                      <input type="hidden" name="discipline_id" value={discipline.id} />
                      <button className="eval-primary-button" type="submit">
                        Activar
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="eval-panel eval-config-section" id="niveles">
          <header>
            <div>
              <h2>Niveles técnicos</h2>
              <p>La escala técnica es independiente de Rewards y del nivel general.</p>
            </div>
          </header>
          <div className="eval-level-pills">
            {levelDefs.map((level) => (
              <span className="eval-level-pill" key={level.id}>
                <strong>{level.title}</strong>
                <small>Nivel {level.level_order}</small>
              </span>
            ))}
          </div>
        </section>

        <section className="eval-panel eval-config-section" id="reglas">
          <header>
            <div>
              <h2>Reglas generales</h2>
              <p>Las plantillas pueden personalizar estos valores por nivel.</p>
            </div>
          </header>
          <div className="eval-shortcuts">
            <article className="eval-shortcut">
              <span aria-hidden="true">◔</span>
              <strong>Ponderación base</strong>
              <small>Ejecución 45% · Fuerza 25% · Líneas 25% · Flexibilidad 5%</small>
            </article>
            <article className="eval-shortcut">
              <span aria-hidden="true">✓</span>
              <strong>Aprobación</strong>
              <small>80% global · 70% mínimo por criterio</small>
            </article>
            <article className="eval-shortcut">
              <span aria-hidden="true">★</span>
              <strong>Obligatorios</strong>
              <small>Pueden bloquear el ascenso aunque el promedio sea suficiente</small>
            </article>
            <article className="eval-shortcut">
              <span aria-hidden="true">◎</span>
              <strong>Visibilidad</strong>
              <small>La alumna sólo ve el resultado cuando se publica</small>
            </article>
          </div>
        </section>

        <section className="eval-panel eval-config-section" id="plantillas">
          <header>
            <div>
              <h2>Plantillas</h2>
              <p>Cada plantilla pertenece a una disciplina y nivel técnico.</p>
            </div>
          </header>

          {activeLinks.length ? (
            <form action={createEvaluationTemplate} className="eval-form">
              <div className="eval-field-grid">
                <div className="eval-field">
                  <label htmlFor="template-name">Nombre</label>
                  <input
                    id="template-name"
                    name="name"
                    placeholder="Pole Fitness · Intermedio"
                    required
                    minLength={2}
                  />
                </div>
                <div className="eval-field">
                  <label htmlFor="discipline-level">Disciplina y nivel</label>
                  <select id="discipline-level" name="discipline_level_id" required defaultValue="">
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {activeLinks.map((link) => (
                      <option key={link.id} value={link.id}>
                        {disciplineById.get(link.discipline_id)?.name ?? "Disciplina"} ·{" "}
                        {levelById.get(link.technical_level_id)?.title ?? "Nivel"}
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
              Activa al menos una disciplina antes de crear una plantilla.
            </div>
          )}

          {templates.length ? (
            <div className="eval-template-grid" style={{ marginTop: 14 }}>
              {templates.map((template) => {
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
                      {disciplineById.get(template.discipline_id)?.name ?? "Disciplina"} ·{" "}
                      {levelById.get(
                        links.find((link) => link.id === template.discipline_technical_level_id)
                          ?.technical_level_id ?? "",
                      )?.title ?? "Nivel"}
                    </p>
                    <span className="eval-template-meta">
                      v{version?.version_number ?? 1} · Editar criterios, figuras y reglas
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
