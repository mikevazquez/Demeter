import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { EvaluationLiveForm } from "../EvaluationLiveForm";
import {
  openEvaluationFeedbackAction,
  publishTechnicalEvaluationAction,
  recalculateTechnicalEvaluationAction,
} from "../actions";

function statusLabel(value: string | null) {
  if (value === "approved") return "Aprobada";
  if (value === "stays") return "Permanece";
  if (value === "incomplete") return "Incompleta";
  return "Pendiente";
}

function snapshotName(value: unknown, fallback: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name ? name : fallback;
}

function snapshotDescription(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const description = (value as Record<string, unknown>).description;
  return typeof description === "string" && description ? description : null;
}

export default async function TechnicalEvaluationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const { id } = await params;
  const qs = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const { data: evaluation } = await ctx.supabase
    .from("technical_evaluations")
    .select(
      "id,student_id,student_name_snapshot,discipline_id,current_discipline_level_id_at_start,target_discipline_level_id,resulting_discipline_level_id,template_version_id,evaluation_date,status,automatic_outcome,final_outcome,total_score,override_reason,strengths,improvement_areas,coach_message,next_objective,last_saved_at,published_at",
    )
    .eq("id", id)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!evaluation) notFound();

  const [disciplineResult, levelLinksResult, versionResult, elementResults, comboResults] =
    await Promise.all([
      ctx.supabase.from("disciplines").select("name").eq("id", evaluation.discipline_id).single(),
      ctx.supabase
        .from("discipline_technical_levels")
        .select("id,technical_level_id,discipline_order")
        .eq("studio_id", ctx.studio.id)
        .eq("discipline_id", evaluation.discipline_id),
      ctx.supabase
        .from("evaluation_template_versions")
        .select(
          "id,template_id,version_number,pass_threshold,default_category_min,default_attempts_per_element,default_attempts_per_combo,evaluator_instructions",
        )
        .eq("id", evaluation.template_version_id)
        .single(),
      ctx.supabase
        .from("technical_evaluation_element_results")
        .select(
          "template_element_id,result_status,score,attempt_count,notes,quick_comments,evaluated_at",
        )
        .eq("evaluation_id", evaluation.id),
      ctx.supabase
        .from("technical_evaluation_combo_results")
        .select(
          "template_combo_id,result_status,score,attempt_count,notes,quick_comments,evaluated_at",
        )
        .eq("evaluation_id", evaluation.id),
    ]);

  const version = versionResult.data;
  if (!version) notFound();

  const [templateResult, criteriaResult, templateElementsResult, templateCombosResult] =
    await Promise.all([
      ctx.supabase
        .from("evaluation_templates")
        .select("name")
        .eq("id", version.template_id)
        .single(),
      ctx.supabase
        .from("evaluation_template_criteria")
        .select("id,label,weight_percent,min_percent,sort_order")
        .eq("template_version_id", version.id)
        .order("sort_order"),
      ctx.supabase
        .from("evaluation_template_elements")
        .select(
          "id,criterion_id,mandatory,scored,max_score,attempts_allowed,sort_order,element_snapshot",
        )
        .eq("template_version_id", version.id)
        .order("sort_order"),
      ctx.supabase
        .from("evaluation_template_combos")
        .select(
          "id,criterion_id,mandatory,scored,max_score,attempts_allowed,sort_order,combo_snapshot",
        )
        .eq("template_version_id", version.id)
        .order("sort_order"),
    ]);

  const levelLinks = levelLinksResult.data ?? [];
  const levelIds = levelLinks.map((link) => link.technical_level_id);
  const levelDefsResult = levelIds.length
    ? await ctx.supabase.from("technical_level_definitions").select("id,title").in("id", levelIds)
    : { data: [] };
  const levelDefMap = new Map((levelDefsResult.data ?? []).map((level) => [level.id, level.title]));
  const levelTitleMap = new Map(
    levelLinks.map((link) => [
      link.id,
      levelDefMap.get(link.technical_level_id) ?? "Nivel técnico",
    ]),
  );

  const elementResultMap = new Map(
    (elementResults.data ?? []).map((result) => [result.template_element_id, result]),
  );
  const comboResultMap = new Map(
    (comboResults.data ?? []).map((result) => [result.template_combo_id, result]),
  );
  const templateElements = templateElementsResult.data ?? [];
  const templateCombos = templateCombosResult.data ?? [];
  const totalItems = templateElements.length + templateCombos.length;
  const evaluatedItems =
    (elementResults.data ?? []).filter((item) => item.result_status !== "not_evaluated").length +
    (comboResults.data ?? []).filter((item) => item.result_status !== "not_evaluated").length;
  const progress = totalItems ? Math.round((evaluatedItems / totalItems) * 100) : 0;

  const liveElements = templateElements.map((item) => {
    const result = elementResultMap.get(item.id);
    return {
      id: item.id,
      criterionId: item.criterion_id,
      name: snapshotName(item.element_snapshot, "Elemento técnico"),
      description: snapshotDescription(item.element_snapshot),
      mandatory: item.mandatory,
      scored: item.scored,
      maxScore: Number(item.max_score),
      attemptsAllowed: item.attempts_allowed ?? version.default_attempts_per_element,
      resultStatus: result?.result_status ?? "not_evaluated",
      score: result?.score === null || result?.score === undefined ? null : Number(result.score),
      attemptCount: result?.attempt_count ?? 0,
      notes: result?.notes ?? "",
    };
  });

  const liveCombos = templateCombos.map((item) => {
    const result = comboResultMap.get(item.id);
    return {
      id: item.id,
      criterionId: item.criterion_id,
      name: snapshotName(item.combo_snapshot, "Combo técnico"),
      description: snapshotDescription(item.combo_snapshot),
      mandatory: item.mandatory,
      scored: item.scored,
      maxScore: Number(item.max_score),
      attemptsAllowed: item.attempts_allowed ?? version.default_attempts_per_combo,
      resultStatus: result?.result_status ?? "not_evaluated",
      score: result?.score === null || result?.score === undefined ? null : Number(result.score),
      attemptCount: result?.attempt_count ?? 0,
      notes: result?.notes ?? "",
    };
  });

  const targetLevel = levelTitleMap.get(evaluation.target_discipline_level_id) ?? "Nivel técnico";
  const currentLevel = evaluation.current_discipline_level_id_at_start
    ? (levelTitleMap.get(evaluation.current_discipline_level_id_at_start) ?? "Nivel técnico")
    : "Sin nivel previo";

  const criterionResultQuery = await ctx.supabase
    .from("technical_evaluation_criterion_results")
    .select("template_criterion_id,score_percent,weighted_points,passed,notes,captured_at")
    .eq("evaluation_id", evaluation.id);
  const criterionResultMap = new Map(
    (criterionResultQuery.data ?? []).map((item) => [item.template_criterion_id, item]),
  );
  const criteria = criteriaResult.data ?? [];
  const liveCriteria = criteria.map((criterion) => {
    const result = criterionResultMap.get(criterion.id);
    return {
      id: criterion.id,
      label: criterion.label,
      weightPercent: Number(criterion.weight_percent),
      minPercent: Number(criterion.min_percent ?? version.default_category_min),
      scorePercent:
        result?.captured_at && result.score_percent !== null && result.score_percent !== undefined
          ? Number(result.score_percent)
          : null,
      notes: result?.notes ?? "",
      captured: Boolean(result?.captured_at),
    };
  });

  const isPublished = evaluation.status === "published";
  const step = isPublished ? "published" : (qs.step ?? "live");

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>
            {step === "live"
              ? "Evaluación en vivo"
              : step === "resumen"
                ? "Resumen de evaluación"
                : step === "feedback"
                  ? "Cierre y feedback"
                  : "Resultado de evaluación"}
          </h1>
          <p>
            {evaluation.student_name_snapshot} · {disciplineResult.data?.name ?? "Disciplina"} ·{" "}
            {targetLevel}
          </p>
        </div>
        <span className={`eval-status ${isPublished ? "approved" : ""}`}>
          {isPublished ? "Publicada" : "Borrador"}
        </span>
      </header>
      {qs.error ? (
        <div className="eval-notice">
          No pudimos completar la acción. Revisa los datos e inténtalo de nuevo.
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>{evaluation.student_name_snapshot}</h2>
            <p>
              {disciplineResult.data?.name ?? "Disciplina"} · Objetivo: {targetLevel} · Actual:{" "}
              {currentLevel}
            </p>
          </div>
          <span className="eval-status">
            v{version.version_number} · {templateResult.data?.name}
          </span>
        </header>
      </section>

      {step === "live" ? (
        <>
          <section className="eval-panel eval-live-progress">
            <div className="eval-progress-header">
              <span>Elementos evaluados</span>
              <strong>
                {evaluatedItems} de {totalItems} · {progress}%
              </strong>
            </div>
            <div className="eval-progress-track">
              <i style={{ width: `${progress}%` }} />
            </div>
          </section>

          <EvaluationLiveForm
            evaluationId={evaluation.id}
            criteria={liveCriteria}
            elements={liveElements}
            combos={liveCombos}
          />

          <form action={recalculateTechnicalEvaluationAction} className="eval-form-actions">
            <input type="hidden" name="evaluation_id" value={evaluation.id} />
            <button className="eval-primary-button" type="submit">
              Finalizar parte técnica →
            </button>
          </form>
        </>
      ) : null}

      {step === "resumen" || step === "feedback" || step === "published" ? (
        <>
          <section className="eval-panel eval-summary-card">
            <div className="eval-summary-top">
              <div className="eval-total-score">
                <small>Resultado global</small>
                <strong>
                  {evaluation.total_score === null ? "—" : `${Math.round(evaluation.total_score)}%`}
                </strong>
                <span className={`eval-status ${evaluation.automatic_outcome ?? ""}`}>
                  {statusLabel(
                    step === "published" ? evaluation.final_outcome : evaluation.automatic_outcome,
                  )}
                </span>
              </div>

              <div className="eval-breakdown">
                {criteria.map((criterion) => {
                  const result = criterionResultMap.get(criterion.id);
                  const score = result ? Number(result.score_percent) : 0;
                  return (
                    <div className="eval-breakdown-row" key={criterion.id}>
                      <span>{criterion.label}</span>
                      <span className="eval-breakdown-track">
                        <i style={{ width: `${Math.min(score, 100)}%` }} />
                      </span>
                      <strong>{Math.round(score)}%</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="eval-feedback-grid">
            <article className="eval-panel eval-feedback-card">
              <h3>Requisitos de progresión · Figuras</h3>
              <p className="eval-row-copy">
                <small>
                  {
                    templateElements.filter(
                      (item) =>
                        item.mandatory && elementResultMap.get(item.id)?.result_status === "meets",
                    ).length
                  }{" "}
                  / {templateElements.filter((item) => item.mandatory).length} cumplen
                </small>
              </p>
            </article>
            <article className="eval-panel eval-feedback-card">
              <h3>Requisitos de progresión · Combos</h3>
              <p className="eval-row-copy">
                <small>
                  {
                    templateCombos.filter(
                      (item) =>
                        item.mandatory && comboResultMap.get(item.id)?.result_status === "meets",
                    ).length
                  }{" "}
                  / {templateCombos.filter((item) => item.mandatory).length} cumplen
                </small>
              </p>
            </article>
          </section>
          <p className="eval-summary-hint">
            Los requisitos de progresión son una condición para subir de nivel, pero todos los
            elementos de la evaluación deben tener resultado. El resultado global también depende
            del puntaje total y de los mínimos configurados.
          </p>
        </>
      ) : null}

      {step === "resumen" ? (
        <div className="eval-form-actions">
          <Link className="eval-secondary-button" href={`/admin/evaluaciones/${evaluation.id}`}>
            {evaluation.automatic_outcome === "incomplete"
              ? "Completar evaluación"
              : "Editar evaluación"}
          </Link>
          {evaluation.automatic_outcome !== "incomplete" ? (
            <form action={openEvaluationFeedbackAction}>
              <input type="hidden" name="evaluation_id" value={evaluation.id} />
              <button className="eval-primary-button" type="submit">
                Continuar con feedback →
              </button>
            </form>
          ) : (
            <span className="eval-notice">
              Faltan datos por evaluar. Todos los elementos deben tener resultado antes de finalizar
              la parte técnica.
            </span>
          )}
        </div>
      ) : null}

      {step === "feedback" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Feedback del coach</h2>
              <p>Convierte el resultado técnico en una guía clara para la alumna.</p>
            </div>
          </header>
          <form action={publishTechnicalEvaluationAction} className="eval-form">
            <input type="hidden" name="evaluation_id" value={evaluation.id} />
            <div className="eval-field-grid">
              <div className="eval-field">
                <label htmlFor="strengths">Fortalezas · una por línea</label>
                <textarea
                  id="strengths"
                  name="strengths"
                  placeholder={"Buen control\nLíneas limpias"}
                />
              </div>
              <div className="eval-field">
                <label htmlFor="improvements">Áreas por mejorar · una por línea</label>
                <textarea
                  id="improvements"
                  name="improvement_areas"
                  placeholder={"Fuerza de entrada\nControl del descenso"}
                />
              </div>
            </div>
            <div className="eval-field">
              <label htmlFor="coach-message">Mensaje del coach</label>
              <textarea
                id="coach-message"
                name="coach_message"
                placeholder="Excelente trabajo. Se nota mucho tu progreso…"
              />
            </div>
            <div className="eval-field">
              <label htmlFor="next-objective">Próximo objetivo</label>
              <textarea
                id="next-objective"
                name="next_objective"
                placeholder="Trabajar fuerza en invert y preparar los combos del siguiente nivel."
              />
            </div>

            <div className="eval-form-actions">
              <Link
                className="eval-secondary-button"
                href={`/admin/evaluaciones/${evaluation.id}?step=resumen`}
              >
                Volver
              </Link>
              <button className="eval-primary-button" type="submit">
                Publicar para la alumna
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {step === "published" ? (
        <>
          <section className="eval-feedback-grid">
            <article className="eval-panel eval-feedback-card">
              <h3>Tus fortalezas</h3>
              {(evaluation.strengths ?? []).length ? (
                <ul>
                  {evaluation.strengths.map((item: string) => (
                    <li key={item}>✓ {item}</li>
                  ))}
                </ul>
              ) : (
                <p className="eval-row-copy">
                  <small>Sin fortalezas capturadas.</small>
                </p>
              )}
            </article>
            <article className="eval-panel eval-feedback-card">
              <h3>Áreas por mejorar</h3>
              {(evaluation.improvement_areas ?? []).length ? (
                <ul>
                  {evaluation.improvement_areas.map((item: string) => (
                    <li key={item}>↗ {item}</li>
                  ))}
                </ul>
              ) : (
                <p className="eval-row-copy">
                  <small>Sin áreas capturadas.</small>
                </p>
              )}
            </article>
          </section>

          {evaluation.coach_message ? (
            <section className="eval-panel eval-config-section">
              <header>
                <div>
                  <h2>Comentario de tu coach</h2>
                </div>
              </header>
              <p style={{ color: "#b8c1cd", fontSize: 11, lineHeight: 1.7 }}>
                {evaluation.coach_message}
              </p>
            </section>
          ) : null}

          {evaluation.next_objective ? (
            <section className="eval-panel eval-config-section">
              <header>
                <div>
                  <h2>Próximo objetivo</h2>
                </div>
              </header>
              <p style={{ color: "#b8c1cd", fontSize: 11, lineHeight: 1.7 }}>
                {evaluation.next_objective}
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
