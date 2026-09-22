import type { CSSProperties } from "react";

import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { EvaluationAspectRow } from "./EvaluationAspectRow";

import {
  activateEvaluationV2Action,
  addEvaluationV2BlockAction,
  addEvaluationV2ItemAction,
  deleteEvaluationV2BlockAction,
  openEvaluationV2EditorAction,
  saveEvaluationV2GeneralAction,
  updateEvaluationV2BlockAction,
  updateEvaluationV2ItemAction,
} from "../../v2-actions";

type EditorTab = "apartados" | "reglas" | "preview";
type SectionView = "config" | "content";

function resolveTab(value?: string): EditorTab {
  if (value === "reglas" || value === "configuracion") return "reglas";
  if (value === "preview" || value === "revision") return "preview";
  return "apartados";
}

function resolveSectionView(value?: string): SectionView {
  return value === "content" ? "content" : "config";
}

function editorUrl(
  templateId: string,
  tab: EditorTab = "apartados",
  blockId?: string,
  view?: SectionView,
) {
  const params = new URLSearchParams({ step: tab });
  if (blockId) params.set("block", blockId);
  if (view) params.set("view", view);
  return `/admin/evaluaciones/v2/${templateId}?${params.toString()}`;
}

function modeLabel(value: string) {
  if (value === "weighted_criteria") return "Por aspectos y puntuación";
  if (value === "meets" || value === "element_list") return "Cumple / No cumple";
  if (value === "correct_incorrect") return "Correcto / Incorrecto";
  return "Una sola calificación";
}

function itemLabel(item: { item_label: string | null; element_snapshot: unknown }) {
  if (item.item_label) return item.item_label;
  if (
    typeof item.element_snapshot === "object" &&
    item.element_snapshot !== null &&
    !Array.isArray(item.element_snapshot)
  ) {
    const name = (item.element_snapshot as Record<string, unknown>).name;
    if (typeof name === "string" && name) return name;
  }
  return "Elemento";
}

function safePercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export default async function EvaluationV2EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; block?: string; view?: string; error?: string }>;
}) {
  const { id } = await params;
  const qs = await searchParams;
  const tab = resolveTab(qs.step);
  const sectionView = resolveSectionView(qs.view);
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);

  const { data: template } = await ctx.supabase
    .from("evaluation_templates")
    .select("id,name,discipline_id,discipline_technical_level_id")
    .eq("id", id)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!template) notFound();

  const [{ data: discipline }, { data: levelLink }, { data: versions }] = await Promise.all([
    ctx.supabase.from("disciplines").select("name").eq("id", template.discipline_id).single(),
    ctx.supabase
      .from("discipline_technical_levels")
      .select("technical_level_id")
      .eq("id", template.discipline_technical_level_id)
      .single(),
    ctx.supabase
      .from("evaluation_template_versions")
      .select(
        "id,version_number,status,schema_version,pass_threshold,evaluator_instructions,updated_at",
      )
      .eq("template_id", template.id)
      .eq("studio_id", ctx.studio.id)
      .order("version_number", { ascending: false }),
  ]);

  const version = versions?.[0];
  if (!version) notFound();

  const { data: level } = levelLink?.technical_level_id
    ? await ctx.supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("id", levelLink.technical_level_id)
        .single()
    : { data: null };

  const disciplineName = discipline?.name ?? "Disciplina";
  const levelTitle = level?.title ?? "Nivel técnico";

  if (version.schema_version !== 2) {
    return (
      <main className="evaluations-page">
        <header className="eval-simple-header">
          <Link className="eval-simple-back" href={`/admin/evaluaciones/disciplina/${template.discipline_id}`}>
            ←
          </Link>
          <div>
            <h1>{disciplineName} · {levelTitle}</h1>
            <p>Configuración de evaluación</p>
          </div>
        </header>

        <section className="eval-simple-panel">
          <span className="eval-simple-kicker">ACTUALIZAR CONFIGURACIÓN</span>
          <h2>Usar el nuevo editor simplificado</h2>
          <p>
            La evaluación anterior se conserva para el historial. La nueva configuración usará
            apartados, pesos y formas de evaluación más claras.
          </p>
          <form action={openEvaluationV2EditorAction}>
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-simple-primary" type="submit">
              Crear nueva configuración →
            </button>
          </form>
        </section>
      </main>
    );
  }

  const [blocksResult, itemsResult, usedResult] = await Promise.all([
    ctx.supabase
      .from("evaluation_template_criteria")
      .select(
        "id,criterion_key,label,description,weight_percent,min_percent,sort_order,block_type,progression_required,evaluator_instructions",
      )
      .eq("template_version_id", version.id)
      .order("sort_order"),
    ctx.supabase
      .from("evaluation_template_elements")
      .select(
        "id,criterion_id,scored,max_score,min_score,attempts_allowed,sort_order,element_snapshot,item_label,item_description,item_kind,item_weight_percent,progression_required,mandatory",
      )
      .eq("template_version_id", version.id)
      .order("sort_order"),
    ctx.supabase
      .from("technical_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("template_version_id", version.id),
  ]);

  const blocks = blocksResult.data ?? [];
  const items = itemsResult.data ?? [];
  const used = (usedResult.count ?? 0) > 0;
  const editable = version.status === "draft" && !used;
  const activeBlock = blocks.find((block) => block.id === qs.block) ?? null;
  const totalWeight = blocks.reduce((sum, block) => sum + Number(block.weight_percent ?? 0), 0);

  const validations = blocks.map((block) => {
    const blockItems = items.filter((item) => item.criterion_id === block.id);
    const itemWeightTotal = blockItems.reduce(
      (sum, item) => sum + Number(item.item_weight_percent ?? 0),
      0,
    );
    const weightedCount = blockItems.filter((item) => item.item_weight_percent !== null).length;
    const requiresItems = block.block_type !== "direct_score";
    const contentValid =
      !requiresItems ||
      (block.block_type === "weighted_criteria"
        ? blockItems.length > 0 &&
          weightedCount === blockItems.length &&
          Math.abs(itemWeightTotal - 100) <= 0.01
        : blockItems.length > 0 &&
          (weightedCount === 0 ||
            (weightedCount === blockItems.length && Math.abs(itemWeightTotal - 100) <= 0.01)));
    const progressionValid =
      (!block.progression_required || block.min_percent !== null) &&
      blockItems.every(
        (item) =>
          !Boolean(item.progression_required || item.mandatory) ||
          !item.scored ||
          item.min_score !== null,
      );

    return {
      id: block.id,
      itemCount: blockItems.length,
      itemWeightTotal,
      valid: contentValid && progressionValid,
    };
  });

  const ready =
    blocks.length > 0 &&
    Math.abs(totalWeight - 100) <= 0.01 &&
    validations.every((item) => item.valid);

  const errorCopy: Record<string, string> = {
    general: "Revisa los datos antes de guardar.",
    block: "No pudimos guardar el apartado. Revisa sus datos.",
    item: "No pudimos guardar el elemento.",
    weights: "Los porcentajes deben sumar 100% antes de activar la evaluación.",
    progression:
      "Todo requisito de progresión con puntuación necesita un mínimo para considerarse cumplido.",
    activate: "Todavía falta completar parte de la configuración.",
    locked: "Esta configuración ya no puede modificarse.",
    version: "No pudimos crear una nueva configuración.",
  };

  if (activeBlock) {
    const blockItems = items.filter((item) => item.criterion_id === activeBlock.id);
    const internalTotal = blockItems.reduce(
      (sum, item) => sum + Number(item.item_weight_percent ?? 0),
      0,
    );
    const normalizedType =
      activeBlock.block_type === "element_list" ? "meets" : activeBlock.block_type;
    const itemTitle =
      normalizedType === "weighted_criteria"
        ? "Aspectos a evaluar"
        : normalizedType === "correct_incorrect"
          ? "Preguntas o conceptos"
          : normalizedType === "meets"
            ? "Elementos a evaluar"
            : "Calificación";
    const addTitle =
      normalizedType === "weighted_criteria"
        ? "Agregar aspecto"
        : normalizedType === "correct_incorrect"
          ? "Agregar pregunta o concepto"
          : "Agregar elemento";

    if (sectionView === "config") {
      return (
        <main className="evaluations-page">
          <header className="eval-simple-section-header">
            <Link className="eval-simple-back" href={editorUrl(template.id, "apartados")}>
              ←
            </Link>
            <div>
              <h1>{activeBlock.label === "Nuevo apartado" ? "Nuevo apartado" : activeBlock.label}</h1>
            </div>
          </header>

          {qs.error ? <div className="eval-simple-error">{errorCopy[qs.error]}</div> : null}

          <section className="eval-simple-panel eval-simple-section-config">
            <div className="eval-simple-section-step">1. Información general</div>
            <form action={updateEvaluationV2BlockAction} className="eval-simple-form">
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="block_id" value={activeBlock.id} />
              <input type="hidden" name="description" value={activeBlock.description ?? ""} />
              <input type="hidden" name="min_percent" value={activeBlock.min_percent ?? ""} />
              <input
                type="hidden"
                name="evaluator_instructions"
                value={activeBlock.evaluator_instructions ?? ""}
              />
              {activeBlock.progression_required ? (
                <input type="hidden" name="progression_required" value="on" />
              ) : null}
              <input type="hidden" name="return_view" value="content" />

              <label className="eval-simple-field">
                <span>Nombre del apartado</span>
                <input
                  name="label"
                  defaultValue={activeBlock.label}
                  disabled={!editable}
                  placeholder="Ej. Combo técnico"
                  required
                />
              </label>

              <label className="eval-simple-field">
                <span>¿Cuánto vale en el resultado final?</span>
                <div className="eval-simple-percent-field">
                  <input
                    name="weight_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={activeBlock.weight_percent}
                    disabled={!editable}
                    required
                  />
                  <span>%</span>
                </div>
              </label>

              <div className="eval-simple-numbered-title">
                <span>2.</span>
                <strong>¿Cómo se evaluará?</strong>
              </div>

              <div className="eval-simple-mode-grid">
                {[
                  {
                    value: "weighted_criteria",
                    icon: "▥",
                    title: "Por aspectos y puntuación",
                    description: "Evalúas varios aspectos con calificación de 0 a 100.",
                  },
                  {
                    value: "meets",
                    icon: "☑",
                    title: "Cumple / No cumple",
                    description: "Lista de elementos que deben cumplirse.",
                  },
                  {
                    value: "correct_incorrect",
                    icon: "⊗",
                    title: "Correcto / Incorrecto",
                    description: "Lista de preguntas o conceptos.",
                  },
                  {
                    value: "direct_score",
                    icon: "★",
                    title: "Una sola calificación",
                    description: "Una calificación general de 0 a 100.",
                  },
                ].map((mode) => (
                  <label className="eval-simple-mode-option" key={mode.value}>
                    <input
                      type="radio"
                      name="block_type"
                      value={mode.value}
                      defaultChecked={normalizedType === mode.value}
                      disabled={!editable}
                    />
                    <span className="eval-simple-mode-icon">{mode.icon}</span>
                    <span>
                      <strong>{mode.title}</strong>
                      <small>{mode.description}</small>
                    </span>
                  </label>
                ))}
              </div>

              <div className="eval-simple-footer-actions">
                <Link className="eval-simple-secondary" href={editorUrl(template.id, "apartados")}>
                  Cancelar
                </Link>
                <button className="eval-simple-primary" type="submit" disabled={!editable}>
                  Siguiente →
                </button>
              </div>
            </form>
          </section>
        </main>
      );
    }

    return (
      <main className="evaluations-page">
        <header className="eval-simple-section-header">
          <Link
            className="eval-simple-back"
            href={editorUrl(template.id, "apartados", activeBlock.id, "config")}
          >
            ←
          </Link>
          <div>
            <h1>{activeBlock.label}</h1>
            <p>{modeLabel(activeBlock.block_type)}</p>
          </div>
          {editable ? (
            <form action={deleteEvaluationV2BlockAction}>
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="block_id" value={activeBlock.id} />
              <button className="eval-simple-trash" type="submit" aria-label="Eliminar apartado">
                ⌫
              </button>
            </form>
          ) : null}
        </header>

        {qs.error ? <div className="eval-simple-error">{errorCopy[qs.error]}</div> : null}

        {normalizedType === "weighted_criteria" ? (
          <section className="eval-simple-panel eval-simple-distribution-card">
            <div className="eval-simple-mini-ring" style={{ "--progress": safePercent(internalTotal) } as CSSProperties}>
              <strong>{internalTotal}%</strong>
            </div>
            <div>
              <span>Distribución del apartado</span>
              <strong>{internalTotal}% de 100%</strong>
              <small className={Math.abs(internalTotal - 100) <= 0.01 ? "is-ok" : ""}>
                {Math.abs(internalTotal - 100) <= 0.01
                  ? "✓ Distribución correcta."
                  : "Los aspectos deben sumar 100%."}
              </small>
            </div>
          </section>
        ) : null}

        <section className="eval-simple-content-section">
          <h2>{itemTitle}</h2>

          {normalizedType === "direct_score" ? (
            <div className="eval-simple-info-card">
              El coach asignará una sola calificación de 0 a 100 para este apartado.
            </div>
          ) : (
            <div className="eval-simple-item-list">
              {blockItems.map((item) => (
                <EvaluationAspectRow
                  key={item.id}
                  templateId={template.id}
                  versionId={version.id}
                  blockId={activeBlock.id}
                  itemId={item.id}
                  name={itemLabel(item)}
                  weightPercent={item.item_weight_percent}
                  minScore={item.min_score}
                  progressionRequired={Boolean(item.progression_required || item.mandatory)}
                  weighted={normalizedType === "weighted_criteria"}
                  editable={editable}
                />
              ))}
            </div>
          )}

          {normalizedType !== "direct_score" && editable ? (
            <details className="eval-simple-add-details">
              <summary>+ {addTitle}</summary>
              <form action={addEvaluationV2ItemAction} className="eval-simple-add-form">
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <input type="hidden" name="block_id" value={activeBlock.id} />
                <input type="hidden" name="discipline_id" value={template.discipline_id} />
                {normalizedType === "weighted_criteria" ? (
                  <>
                    <input type="hidden" name="scored" value="on" />
                    <input type="hidden" name="max_score" value="100" />
                  </>
                ) : null}
                <label className="eval-simple-field">
                  <span>Nombre</span>
                  <input
                    name="label"
                    placeholder={
                      normalizedType === "weighted_criteria"
                        ? "Ej. Fluidez"
                        : normalizedType === "correct_incorrect"
                          ? "Ej. Nombre de figura"
                          : "Ej. Inversión"
                    }
                    required
                  />
                </label>
                {normalizedType === "weighted_criteria" ? (
                  <label className="eval-simple-field">
                    <span>Peso dentro del apartado</span>
                    <div className="eval-simple-percent-field">
                      <input
                        name="item_weight_percent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="0"
                        required
                      />
                      <span>%</span>
                    </div>
                  </label>
                ) : (
                  <input type="hidden" name="item_weight_percent" value="" />
                )}
                <button className="eval-simple-primary" type="submit">
                  Agregar
                </button>
              </form>
            </details>
          ) : null}

          {normalizedType === "weighted_criteria" ? (
            <div className="eval-simple-info-card">
              ⓘ Los porcentajes de todos los aspectos deben sumar 100%.
            </div>
          ) : null}

          <details className="eval-simple-accordion">
            <summary>
              <span>⚙</span>
              <strong>Reglas para avanzar (opcional)</strong>
              <span>›</span>
            </summary>
            <div className="eval-simple-accordion-body">
              <form action={updateEvaluationV2BlockAction} className="eval-simple-form">
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <input type="hidden" name="block_id" value={activeBlock.id} />
                <input type="hidden" name="label" value={activeBlock.label} />
                <input type="hidden" name="description" value={activeBlock.description ?? ""} />
                <input type="hidden" name="weight_percent" value={activeBlock.weight_percent} />
                <input type="hidden" name="block_type" value={normalizedType} />
                <input
                  type="hidden"
                  name="evaluator_instructions"
                  value={activeBlock.evaluator_instructions ?? ""}
                />
                <input type="hidden" name="return_view" value="content" />

                <label className="eval-simple-field">
                  <span>Mínimo del apartado</span>
                  <div className="eval-simple-percent-field">
                    <input
                      name="min_percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={activeBlock.min_percent ?? ""}
                      placeholder="Opcional"
                    />
                    <span>%</span>
                  </div>
                </label>
                <label className="eval-simple-check">
                  <input
                    name="progression_required"
                    type="checkbox"
                    defaultChecked={activeBlock.progression_required}
                  />
                  <span>Este apartado debe cumplirse para avanzar de nivel</span>
                </label>
                <button className="eval-simple-secondary" type="submit">
                  Guardar reglas
                </button>
              </form>

              {blockItems.length ? (
                <div className="eval-simple-requirements-list">
                  <span>Elementos indispensables</span>
                  {blockItems.map((item) => (
                    <form action={updateEvaluationV2ItemAction} key={item.id}>
                      <input type="hidden" name="template_id" value={template.id} />
                      <input type="hidden" name="version_id" value={version.id} />
                      <input type="hidden" name="block_id" value={activeBlock.id} />
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="label" value={itemLabel(item)} />
                      <input
                        type="hidden"
                        name="item_weight_percent"
                        value={item.item_weight_percent ?? ""}
                      />
                      <label className="eval-simple-check">
                        <input
                          name="progression_required"
                          type="checkbox"
                          defaultChecked={Boolean(item.progression_required || item.mandatory)}
                        />
                        <span>{itemLabel(item)}</span>
                      </label>
                      {item.scored ? (
                        <label className="eval-simple-requirement-min">
                          <span>Mínimo</span>
                          <input
                            name="min_score"
                            type="number"
                            min="0"
                            max={item.max_score}
                            step="0.01"
                            defaultValue={item.min_score ?? ""}
                            placeholder="0"
                          />
                        </label>
                      ) : (
                        <input type="hidden" name="min_score" value="" />
                      )}
                      <button className="eval-simple-mini-save" type="submit">
                        Guardar
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
            </div>
          </details>

          <details className="eval-simple-accordion">
            <summary>
              <span>▤</span>
              <strong>Instrucciones para el evaluador (opcional)</strong>
              <span>›</span>
            </summary>
            <form action={updateEvaluationV2BlockAction} className="eval-simple-accordion-body eval-simple-form">
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="block_id" value={activeBlock.id} />
              <input type="hidden" name="label" value={activeBlock.label} />
              <input type="hidden" name="description" value={activeBlock.description ?? ""} />
              <input type="hidden" name="weight_percent" value={activeBlock.weight_percent} />
              <input type="hidden" name="block_type" value={normalizedType} />
              <input type="hidden" name="min_percent" value={activeBlock.min_percent ?? ""} />
              {activeBlock.progression_required ? (
                <input type="hidden" name="progression_required" value="on" />
              ) : null}
              <input type="hidden" name="return_view" value="content" />
              <label className="eval-simple-field">
                <span>Indicaciones para el coach</span>
                <textarea
                  name="evaluator_instructions"
                  defaultValue={activeBlock.evaluator_instructions ?? ""}
                  placeholder="Ej. Priorizar control, limpieza y continuidad."
                />
              </label>
              <button className="eval-simple-secondary" type="submit">
                Guardar instrucciones
              </button>
            </form>
          </details>

          <div className="eval-simple-footer-actions">
            <Link
              className="eval-simple-secondary"
              href={editorUrl(template.id, "apartados", activeBlock.id, "config")}
            >
              ← Anterior
            </Link>
            <Link className="eval-simple-primary" href={editorUrl(template.id, "apartados")}>
              Guardar apartado
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="evaluations-page">
      <header className="eval-simple-header">
        <Link className="eval-simple-back" href={`/admin/evaluaciones/disciplina/${template.discipline_id}`}>
          ←
        </Link>
        <div>
          <h1>{disciplineName} · {levelTitle}</h1>
          <p>Configuración de evaluación</p>
        </div>
        <span className="eval-simple-more">•••</span>
      </header>

      {qs.error ? <div className="eval-simple-error">{errorCopy[qs.error]}</div> : null}

      {!editable ? (
        <section className="eval-simple-lock">
          <div>
            <strong>Configuración protegida</strong>
            <span>Los cambios se aplicarán únicamente a evaluaciones nuevas.</span>
          </div>
          <form action={openEvaluationV2EditorAction}>
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-simple-secondary" type="submit">
              Editar configuración
            </button>
          </form>
        </section>
      ) : null}

      <nav className="eval-simple-tabs" aria-label="Editor de evaluación">
        <Link className={tab === "apartados" ? "is-active" : ""} href={editorUrl(template.id, "apartados")}>
          Apartados
        </Link>
        <Link className={tab === "reglas" ? "is-active" : ""} href={editorUrl(template.id, "reglas")}>
          Reglas
        </Link>
        <Link className={tab === "preview" ? "is-active" : ""} href={editorUrl(template.id, "preview")}>
          Vista previa
        </Link>
      </nav>

      {tab === "apartados" ? (
        <section className="eval-simple-overview">
          <div className="eval-simple-total-card">
            <div
              className="eval-simple-ring"
              style={{ "--progress": safePercent(totalWeight) } as CSSProperties}
            >
              <strong>{totalWeight}%</strong>
            </div>
            <div>
              <span>Resultado final</span>
              <strong>{totalWeight}% de 100%</strong>
              <small className={Math.abs(totalWeight - 100) <= 0.01 ? "is-ok" : ""}>
                {Math.abs(totalWeight - 100) <= 0.01
                  ? "✓ La evaluación está completa."
                  : `Falta asignar ${Math.max(0, 100 - totalWeight)}%.`}
              </small>
            </div>
          </div>

          <div className="eval-simple-section-list">
            {blocks.map((block, index) => (
              <Link
                className="eval-simple-section-card"
                href={editorUrl(template.id, "apartados", block.id, "config")}
                key={block.id}
              >
                <span className="eval-simple-drag" aria-hidden="true">⠿</span>
                <span className="eval-simple-index">{index + 1}</span>
                <span className="eval-simple-section-copy">
                  <strong>{block.label}</strong>
                  <small>{block.weight_percent}% del resultado</small>
                </span>
                <span className="eval-simple-chevron">›</span>
              </Link>
            ))}
          </div>

          {editable ? (
            <form action={addEvaluationV2BlockAction}>
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <button className="eval-simple-add-section" type="submit">
                + Agregar apartado
              </button>
            </form>
          ) : null}

          <div className="eval-simple-info-card">
            ⓘ Los porcentajes de todos los apartados deben sumar 100% para poder activar la evaluación.
          </div>
        </section>
      ) : null}

      {tab === "reglas" ? (
        <section className="eval-simple-panel">
          <span className="eval-simple-kicker">REGLAS GENERALES</span>
          <h2>¿Cuándo se considera aprobada?</h2>
          <p>
            Estas reglas se aplican después de calcular el resultado de todos los apartados.
          </p>

          <form action={saveEvaluationV2GeneralAction} className="eval-simple-form">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <input type="hidden" name="name" value={template.name} />
            <input type="hidden" name="return_step" value="reglas" />

            <label className="eval-simple-field">
              <span>Mínimo global para aprobar</span>
              <div className="eval-simple-percent-field">
                <input
                  name="pass_threshold"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={version.pass_threshold}
                  disabled={!editable}
                  required
                />
                <span>%</span>
              </div>
            </label>

            <label className="eval-simple-field">
              <span>Instrucciones generales para el coach</span>
              <textarea
                name="instructions"
                defaultValue={version.evaluator_instructions ?? ""}
                disabled={!editable}
                placeholder="Opcional"
              />
            </label>

            {editable ? (
              <button className="eval-simple-primary" type="submit">
                Guardar reglas
              </button>
            ) : null}
          </form>
        </section>
      ) : null}

      {tab === "preview" ? (
        <section className="eval-simple-preview">
          <div className="eval-simple-total-card">
            <div
              className="eval-simple-ring"
              style={{ "--progress": safePercent(totalWeight) } as CSSProperties}
            >
              <strong>{totalWeight}%</strong>
            </div>
            <div>
              <span>Resultado final</span>
              <strong>{totalWeight}% de 100%</strong>
              <small className={ready ? "is-ok" : ""}>
                {ready ? "✓ Configuración lista." : "Todavía falta completar la evaluación."}
              </small>
            </div>
          </div>

          <div className="eval-simple-preview-list">
            {blocks.map((block) => {
              const validation = validations.find((item) => item.id === block.id);
              return (
                <article key={block.id}>
                  <div>
                    <strong>{block.label}</strong>
                    <span>{modeLabel(block.block_type)}</span>
                  </div>
                  <div>
                    <strong>{block.weight_percent}%</strong>
                    <span className={validation?.valid ? "is-ok" : ""}>
                      {validation?.valid ? "Completo ✓" : "Revisar"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="eval-simple-rule-summary">
            <span>Mínimo global</span>
            <strong>{version.pass_threshold}%</strong>
          </div>

          <div className="eval-simple-info-card">
            Al activar, esta configuración se usará sólo en evaluaciones nuevas. Las evaluaciones anteriores o en curso conservan su configuración.
          </div>

          {editable ? (
            <form action={activateEvaluationV2Action}>
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="discipline_id" value={template.discipline_id} />
              <button className="eval-simple-primary eval-simple-full" type="submit" disabled={!ready}>
                Activar evaluación
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
