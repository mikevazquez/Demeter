import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { createTechnicalEvaluationAction } from "../actions";

const errorCopy: Record<string, string> = {
  template: "La configuración seleccionada ya no está disponible.",
  create: "No pudimos crear la evaluación.",
};

export default async function NewTechnicalEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const qs = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);

  const [studentsResult, versionsResult, disciplinesResult, linksResult, definitionsResult] =
    await Promise.all([
      ctx.supabase
        .from("students")
        .select("id,full_name,active")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .order("full_name"),
      ctx.supabase
        .from("evaluation_template_versions")
        .select("id,template_id,version_number,status")
        .eq("studio_id", ctx.studio.id)
        .eq("status", "active")
        .order("version_number", { ascending: false }),
      ctx.supabase
        .from("disciplines")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true),
      ctx.supabase
        .from("discipline_technical_levels")
        .select("id,discipline_id,technical_level_id")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true),
      ctx.supabase
        .from("technical_level_definitions")
        .select("id,title")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true),
    ]);

  const versions = Array.from(
    new Map(
      (versionsResult.data ?? []).map((version) => [version.template_id, version]),
    ).values(),
  );
  const templateIds = Array.from(new Set(versions.map((version) => version.template_id)));
  const templatesResult = templateIds.length
    ? await ctx.supabase
        .from("evaluation_templates")
        .select("id,name,discipline_id,discipline_technical_level_id")
        .in("id", templateIds)
        .eq("studio_id", ctx.studio.id)
    : { data: [] };

  const templates = new Map(
    (templatesResult.data ?? []).map((template) => [template.id, template]),
  );
  const disciplines = new Map(
    (disciplinesResult.data ?? []).map((discipline) => [discipline.id, discipline.name]),
  );
  const definitions = new Map(
    (definitionsResult.data ?? []).map((level) => [level.id, level.title]),
  );
  const links = new Map(
    (linksResult.data ?? []).map((link) => [
      link.id,
      {
        disciplineId: link.discipline_id,
        title: definitions.get(link.technical_level_id) ?? "Nivel técnico",
      },
    ]),
  );

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone || "America/Mexico_City",
  }).format(new Date());

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>Nueva evaluación</h1>
          <p>Selecciona alumna y nivel objetivo.</p>
        </div>
      </header>

      {qs.error ? (
        <div className="eval-notice">
          {errorCopy[qs.error] ?? "No pudimos crear la evaluación."}
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        {!versions.length ? (
          <div className="eval-empty">
            No hay niveles configurados para evaluar. Primero edita y guarda un nivel.
            <div style={{ marginTop: 12 }}>
              <Link className="eval-primary-button" href="/admin/evaluaciones">
                Ir a Evaluaciones
              </Link>
            </div>
          </div>
        ) : (
          <form action={createTechnicalEvaluationAction} className="eval-form">
            <div className="eval-field">
              <label htmlFor="student">Alumna</label>
              <select id="student" name="student_id" required defaultValue="">
                <option value="" disabled>
                  Selecciona la alumna a evaluar…
                </option>
                {(studentsResult.data ?? []).map((student) => (
                  <option value={student.id} key={student.id}>
                    {student.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="eval-field">
              <label htmlFor="template-version">Disciplina y nivel</label>
              <select id="template-version" name="template_version_id" required defaultValue="">
                <option value="" disabled>
                  Selecciona la evaluación…
                </option>
                {versions.map((version) => {
                  const template = templates.get(version.template_id);
                  if (!template) return null;
                  const level = links.get(template.discipline_technical_level_id);
                  return (
                    <option value={version.id} key={version.id}>
                      {disciplines.get(template.discipline_id) ?? "Disciplina"} ·{" "}
                      {level?.title ?? "Nivel"}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="eval-field-grid">
              <div className="eval-field">
                <label htmlFor="evaluation-date">Fecha de evaluación</label>
                <input
                  id="evaluation-date"
                  name="evaluation_date"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="eval-field">
                <label>Evaluador</label>
                <input value="Usuario actual" readOnly aria-label="Evaluador actual" />
              </div>
            </div>

            <div className="eval-notice">
              La evaluación se creará como borrador. La alumna no verá ningún resultado hasta que la
              publiques.
            </div>

            <div className="eval-form-actions">
              <Link className="eval-secondary-button" href="/admin/evaluaciones">
                Cancelar
              </Link>
              <button className="eval-primary-button" type="submit">
                Iniciar evaluación →
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
