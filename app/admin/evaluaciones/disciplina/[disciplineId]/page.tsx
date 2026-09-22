import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { setEvaluationDisciplineLevelActive } from "../../actions";
import { createEvaluationV2TemplateAction, openEvaluationV2EditorAction } from "../../v2-actions";

export default async function EvaluationDisciplinePage({
  params,
  searchParams,
}: {
  params: Promise<{ disciplineId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { disciplineId } = await params;
  const qs = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);

  const { data: discipline } = await ctx.supabase
    .from("disciplines")
    .select("id,name,active")
    .eq("id", disciplineId)
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .maybeSingle();

  if (!discipline) notFound();

  const [linksResult, definitionsResult, templatesResult] = await Promise.all([
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
      .select("id,name,discipline_technical_level_id,updated_at,archived_at")
      .eq("studio_id", ctx.studio.id)
      .eq("discipline_id", discipline.id)
      .order("updated_at", { ascending: false }),
  ]);

  const links = linksResult.data ?? [];
  const definitions = definitionsResult.data ?? [];
  const templates = (templatesResult.data ?? []).filter(
    (template) => template.archived_at === null,
  );
  const definitionById = new Map(definitions.map((level) => [level.id, level]));

  const templateIds = templates.map((template) => template.id);
  const versionsResult = templateIds.length
    ? await ctx.supabase
        .from("evaluation_template_versions")
        .select("id,template_id,version_number,status,schema_version,pass_threshold")
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
      schema_version: number;
      pass_threshold: number;
    }
  >();

  for (const version of versionsResult.data ?? []) {
    if (!latestVersion.has(version.template_id)) {
      latestVersion.set(version.template_id, version);
    }
  }

  const latestVersionIds = Array.from(latestVersion.values()).map((version) => version.id);
  const usedResult = latestVersionIds.length
    ? await ctx.supabase
        .from("technical_evaluations")
        .select("template_version_id")
        .in("template_version_id", latestVersionIds)
    : { data: [] };
  const usedVersionIds = new Set(
    (usedResult.data ?? []).map((evaluation) => evaluation.template_version_id),
  );

  const errorCopy: Record<string, string> = {
    level: "No pudimos actualizar el nivel.",
    template: "No pudimos abrir la configuración del nivel.",
  };

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>{discipline.name}</h1>
          <p>Activa, desactiva o edita cada nivel técnico.</p>
        </div>
      </header>

      {qs.error ? (
        <div className="eval-notice">
          {errorCopy[qs.error] ?? "No pudimos completar la acción."}
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>Niveles</h2>
            <p>La configuración de cada nivel se mantiene independiente.</p>
          </div>
        </header>

        {links.length ? (
          <div className="eval-discipline-list">
            {links.map((link) => {
              const definition = definitionById.get(link.technical_level_id);
              const levelTitle = definition?.title ?? "Nivel técnico";
              const template = templates.find(
                (item) => item.discipline_technical_level_id === link.id,
              );
              const version = template ? latestVersion.get(template.id) : undefined;
              const used = version ? usedVersionIds.has(version.id) : false;

              return (
                <article className="eval-level-row" key={link.id}>
                  <span className="eval-level-number" aria-hidden="true">
                    {link.discipline_order}
                  </span>

                  <span className="eval-discipline-copy">
                    <strong>{levelTitle}</strong>
                    <small>
                      {version?.status === "active"
                        ? `Evaluación activa · mínimo ${version.pass_threshold}%`
                        : version?.status === "draft"
                          ? "Configuración en borrador"
                          : "Sin evaluación activa"}
                    </small>
                  </span>

                  <span className={`eval-status ${link.active ? "approved" : ""}`}>
                    {link.active ? "Activo" : "Inactivo"}
                  </span>

                  <div className="eval-level-actions">
                    {!template ? (
                      <form action={createEvaluationV2TemplateAction}>
                        <input type="hidden" name="discipline_id" value={discipline.id} />
                        <input type="hidden" name="discipline_level_id" value={link.id} />
                        <input
                          type="hidden"
                          name="name"
                          value={`${discipline.name} · ${levelTitle}`}
                        />
                        <button className="eval-secondary-button" type="submit">
                          Configurar
                        </button>
                      </form>
                    ) : version?.schema_version === 2 && version.status === "draft" && !used ? (
                      <Link
                        className="eval-secondary-button"
                        href={`/admin/evaluaciones/v2/${template.id}?step=apartados`}
                      >
                        Editar
                      </Link>
                    ) : version ? (
                      <form action={openEvaluationV2EditorAction}>
                        <input type="hidden" name="template_id" value={template.id} />
                        <input type="hidden" name="version_id" value={version.id} />
                        <button className="eval-secondary-button" type="submit">
                          Editar
                        </button>
                      </form>
                    ) : null}

                    <form action={setEvaluationDisciplineLevelActive}>
                      <input type="hidden" name="discipline_id" value={discipline.id} />
                      <input type="hidden" name="discipline_level_id" value={link.id} />
                      <input type="hidden" name="active" value={link.active ? "false" : "true"} />
                      <button
                        className={link.active ? "eval-danger-button" : "eval-primary-button"}
                        type="submit"
                      >
                        {link.active ? "Desactivar" : "Activar"}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="eval-empty">
            No hay niveles técnicos disponibles para esta disciplina.
          </div>
        )}
      </section>
    </main>
  );
}
