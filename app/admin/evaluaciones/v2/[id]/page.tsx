import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  activateEvaluationV2Action,
  addEvaluationV2BlockAction,
  addEvaluationV2ItemAction,
  deleteEvaluationV2BlockAction,
  deleteEvaluationV2ItemAction,
  distributeEvaluationV2ItemWeightsAction,
  openEvaluationV2EditorAction,
  saveEvaluationV2GeneralAction,
  updateEvaluationV2BlockAction,
  updateEvaluationV2ItemAction,
} from "../../v2-actions";

type EditorStep = "configuracion" | "bloques" | "revision";

function resolveStep(value?: string): EditorStep {
  if (value === "bloques" || value === "revision") return value;
  return "configuracion";
}

function blockTypeLabel(value: string) {
  const labels: Record<string, string> = {
    direct_score: "Puntuación directa",
    weighted_criteria: "Varios criterios",
    element_list: "Lista de elementos",
    correct_incorrect: "Correcto / Incorrecto",
    meets: "Cumple / No cumple",
  };
  return labels[value] ?? value;
}

function itemLabel(item: {
  item_label: string | null;
  element_snapshot: unknown;
}) {
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

export default async function EvaluationV2EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; block?: string; error?: string }>;
}) {
  const { id } = await params;
  const qs = await searchParams;
  const step = resolveStep(qs.step);
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

  if (version.schema_version !== 2) {
    return (
      <main className="evaluations-page">
        <header className="eval-header">
          <div className="eval-header-copy">
            <Link
              className="back-link compact"
              href={`/admin/evaluaciones/disciplina/${template.discipline_id}`}
            >
              ← {discipline?.name ?? "Disciplina"}
            </Link>
            <h1>{discipline?.name} · {level?.title ?? "Nivel técnico"}</h1>
            <p>La configuración anterior se conserva intacta para el historial.</p>
          </div>
        </header>
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Actualizar al editor configurable</h2>
              <p>
                Crea una nueva edición para usar bloques, pesos y requisitos de progresión sin
                modificar evaluaciones anteriores.
              </p>
            </div>
          </header>
          <form action={openEvaluationV2EditorAction} className="eval-form-actions">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-primary-button" type="submit">
              Crear edición configurable →
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
  const activeBlock =
    blocks.find((block) => block.id === qs.block) ?? (qs.block ? undefined : null);
  const totalWeight = blocks.reduce((sum, block) => sum + Number(block.weight_percent ?? 0), 0);
  const levelTitle = level?.title ?? "Nivel técnico";

  const blockValidation = blocks.map((block) => {
    const blockItems = items.filter((item) => item.criterion_id === block.id);
    const itemWeightTotal = blockItems.reduce(
      (sum, item) => sum + Number(item.item_weight_percent ?? 0),
      0,
    );
    const weightedCount = blockItems.filter((item) => item.item_weight_percent !== null).length;
    const needsItems = block.block_type !== "direct_score";
    const internalWeightValid =
      !needsItems ||
      (block.block_type === "weighted_criteria"
        ? blockItems.length > 0 &&
          weightedCount === blockItems.length &&
          Math.abs(itemWeightTotal - 100) <= 0.01
        : blockItems.length > 0 &&
          (weightedCount === 0 ||
            (weightedCount === blockItems.length && Math.abs(itemWeightTotal - 100) <= 0.01)));
    return {
      id: block.id,
      valid: internalWeightValid,
      itemCount: blockItems.length,
      itemWeightTotal,
    };
  });

  const ready =
    blocks.length > 0 &&
    Math.abs(totalWeight - 100) <= 0.01 &&
    blockValidation.every((item) => item.valid);

  const errorCopy: Record<string, string> = {
    general: "Revisa el nombre y el porcentaje mínimo.",
    block: "No pudimos guardar el bloque. Revisa sus datos.",
    item: "No pudimos guardar el elemento.",
    weights: "Los pesos deben sumar 100% antes de activar la evaluación.",
    activate: "Todavía falta completar parte de la configuración.",
    locked: "Esta edición ya no puede modificarse.",
    version: "No pudimos crear una nueva edición.",
  };

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link
            className="back-link compact"
            href={`/admin/evaluaciones/disciplina/${template.discipline_id}`}
          >
            ← {discipline?.name ?? "Disciplina"}
          </Link>
          <h1>{discipline?.name ?? "Disciplina"} · {levelTitle}</h1>
          <p>Editor de evaluación</p>
        </div>
        <span className={`eval-status ${version.status === "active" ? "approved" : ""}`}>
          {version.status === "active" ? "Activa" : "Borrador"}
        </span>
      </header>

      {qs.error ? (
        <div className="eval-notice">{errorCopy[qs.error] ?? "No pudimos completar la acción."}</div>
      ) : null}

      {!editable ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Configuración protegida</h2>
              <p>
                Esta edición está activa o ya fue utilizada. Los cambios se hacen en una nueva
                edición para conservar el historial.
              </p>
            </div>
          </header>
          <form action={openEvaluationV2EditorAction} className="eval-form-actions">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-primary-button" type="submit">
              Editar configuración →
            </button>
          </form>
        </section>
      ) : null}

      <nav className="eval-v2-steps" aria-label="Editor de evaluación">
        <Link
          className={step === "configuracion" ? "is-active" : ""}
          href={editorUrl(template.id, "configuracion")}
        >
          1. Configuración
        </Link>
        <Link
          className={step === "bloques" ? "is-active" : ""}
          href={editorUrl(template.id, "bloques")}
        >
          2. Bloques
        </Link>
        <Link
          className={step === "revision" ? "is-active" : ""}
          href={editorUrl(template.id, "revision")}
        >
          3. Revisión
        </Link>
      </nav>

      {step === "configuracion" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <span className="eval-step-label">Información general</span>
              <h2>{levelTitle}</h2>
              <p>
                Esta configuración sirve tanto para colocación inicial como para progresión del
                nivel.
              </p>
            </div>
          </header>

          <form action={saveEvaluationV2GeneralAction} className="eval-form">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />

            <div className="eval-field-grid">
              <label className="eval-field">
                <span>Nombre de la evaluación</span>
                <input name="name" defaultValue={template.name} disabled={!editable} required />
              </label>
              <label className="eval-field">
                <span>Mínimo global para aprobar</span>
                <div className="eval-v2-percent-input">
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
            </div>

            <label className="eval-field">
              <span>Instrucciones para el coach</span>
              <textarea
                name="instructions"
                defaultValue={version.evaluator_instructions ?? ""}
                disabled={!editable}
                placeholder="Indicaciones que aparecerán durante la evaluación…"
              />
            </label>

            {editable ? (
              <div className="eval-form-actions">
                <button className="eval-primary-button" type="submit">
                  Siguiente →
                </button>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {step === "bloques" ? (
        <>
          <section className="eval-panel eval-config-section">
            <header>
              <div>
                <span className="eval-step-label">Bloques de evaluación</span>
                <h2>Peso total</h2>
                <p>Los bloques que aportan calificación deben sumar exactamente 100%.</p>
              </div>
              <span className={`eval-status ${Math.abs(totalWeight - 100) <= 0.01 ? "approved" : "incomplete"}`}>
                {totalWeight}% de 100%
              </span>
            </header>
            <div className="eval-v2-weight-track">
              <i style={{ width: `${Math.min(100, totalWeight)}%` }} />
            </div>

            <div className="eval-v2-block-list">
              {blocks.map((block) => {
                const validation = blockValidation.find((item) => item.id === block.id);
                return (
                  <Link
                    className={`eval-v2-block-card ${activeBlock?.id === block.id ? "is-active" : ""}`}
                    href={editorUrl(template.id, "bloques", block.id)}
                    key={block.id}
                  >
                    <span className="eval-discipline-icon" aria-hidden="true">◇</span>
                    <span className="eval-discipline-copy">
                      <strong>{block.label}</strong>
                      <small>
                        {blockTypeLabel(block.block_type)}
                        {block.block_type !== "direct_score"
                          ? ` · ${validation?.itemCount ?? 0} elementos`
                          : ""}
                      </small>
                    </span>
                    <strong>{block.weight_percent}%</strong>
                    <span aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </div>

            {editable ? (
              <form action={addEvaluationV2BlockAction}>
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <button className="eval-v2-add-button" type="submit">
                  + Agregar bloque
                </button>
              </form>
            ) : null}

            <div className="eval-form-actions eval-v2-nav-actions">
              <Link className="eval-secondary-button" href={editorUrl(template.id, "configuracion")}>
                ← Anterior
              </Link>
              <Link className="eval-primary-button" href={editorUrl(template.id, "revision")}>
                Siguiente →
              </Link>
            </div>
          </section>

          {activeBlock ? (
            <section className="eval-panel eval-config-section eval-v2-block-editor">
              <header>
                <div>
                  <span className="eval-step-label">Editar bloque</span>
                  <h2>{activeBlock.label}</h2>
                  <p>{blockTypeLabel(activeBlock.block_type)}</p>
                </div>
              </header>

              <form action={updateEvaluationV2BlockAction} className="eval-form">
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <input type="hidden" name="block_id" value={activeBlock.id} />

                <div className="eval-field-grid">
                  <label className="eval-field">
                    <span>Nombre del bloque</span>
                    <input name="label" defaultValue={activeBlock.label} disabled={!editable} />
                  </label>
                  <label className="eval-field">
                    <span>Peso en la evaluación</span>
                    <div className="eval-v2-percent-input">
                      <input
                        name="weight_percent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue={activeBlock.weight_percent}
                        disabled={!editable}
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>

                <label className="eval-field">
                  <span>¿Cómo quieres evaluar este bloque?</span>
                  <select name="block_type" defaultValue={activeBlock.block_type} disabled={!editable}>
                    <option value="direct_score">Puntuación directa</option>
                    <option value="weighted_criteria">Varios criterios</option>
                    <option value="element_list">Lista de elementos</option>
                    <option value="correct_incorrect">Correcto / Incorrecto</option>
                    <option value="meets">Cumple / No cumple</option>
                  </select>
                </label>

                <div className="eval-field-grid">
                  <label className="eval-field">
                    <span>Mínimo específico del bloque (opcional)</span>
                    <input
                      name="min_percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={activeBlock.min_percent ?? ""}
                      disabled={!editable}
                      placeholder="Sin mínimo"
                    />
                  </label>
                  <label className="eval-v2-check">
                    <input
                      name="progression_required"
                      type="checkbox"
                      defaultChecked={activeBlock.progression_required}
                      disabled={!editable}
                    />
                    <span>Este bloque es requisito para progresión</span>
                  </label>
                </div>

                <label className="eval-field">
                  <span>Descripción</span>
                  <textarea
                    name="description"
                    defaultValue={activeBlock.description ?? ""}
                    disabled={!editable}
                  />
                </label>

                <label className="eval-field">
                  <span>Instrucciones del bloque</span>
                  <textarea
                    name="evaluator_instructions"
                    defaultValue={activeBlock.evaluator_instructions ?? ""}
                    disabled={!editable}
                  />
                </label>

                {editable ? (
                  <div className="eval-form-actions">
                    <button className="eval-primary-button" type="submit">Guardar bloque</button>
                  </div>
                ) : null}
              </form>

              {activeBlock.block_type !== "direct_score" ? (
                <div className="eval-v2-items-section">
                  <div className="eval-v2-items-heading">
                    <div>
                      <h3>
                        {activeBlock.block_type === "weighted_criteria"
                          ? "Criterios del bloque"
                          : activeBlock.block_type === "correct_incorrect"
                            ? "Preguntas / nombres"
                            : "Elementos del bloque"}
                      </h3>
                      <p>
                        {items.filter((item) => item.criterion_id === activeBlock.id).length} elementos
                      </p>
                    </div>
                    {editable &&
                    items.filter((item) => item.criterion_id === activeBlock.id).length > 1 ? (
                      <form action={distributeEvaluationV2ItemWeightsAction}>
                        <input type="hidden" name="template_id" value={template.id} />
                        <input type="hidden" name="version_id" value={version.id} />
                        <input type="hidden" name="block_id" value={activeBlock.id} />
                        <button className="eval-secondary-button" type="submit">
                          Distribuir peso por igual
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div className="eval-v2-item-list">
                    {items
                      .filter((item) => item.criterion_id === activeBlock.id)
                      .map((item) => (
                        <form
                          action={updateEvaluationV2ItemAction}
                          className="eval-v2-item-row"
                          key={item.id}
                        >
                          <input type="hidden" name="template_id" value={template.id} />
                          <input type="hidden" name="version_id" value={version.id} />
                          <input type="hidden" name="block_id" value={activeBlock.id} />
                          <input type="hidden" name="item_id" value={item.id} />
                          <input
                            className="eval-v2-item-name"
                            name="label"
                            defaultValue={itemLabel(item)}
                            disabled={!editable}
                          />
                          <div className="eval-v2-mini-percent">
                            <input
                              name="item_weight_percent"
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              defaultValue={item.item_weight_percent ?? ""}
                              disabled={!editable}
                              placeholder="—"
                            />
                            <span>%</span>
                          </div>
                          <label className="eval-v2-check compact">
                            <input
                              name="progression_required"
                              type="checkbox"
                              defaultChecked={Boolean(item.progression_required || item.mandatory)}
                              disabled={!editable}
                            />
                            <span>Requisito para progresión</span>
                          </label>
                          {editable ? (
                            <>
                              <button className="eval-secondary-button compact" type="submit">
                                Guardar
                              </button>
                              <button
                                className="eval-icon-danger"
                                type="submit"
                                formAction={deleteEvaluationV2ItemAction}
                                aria-label={`Eliminar ${itemLabel(item)}`}
                              >
                                ×
                              </button>
                            </>
                          ) : null}
                        </form>
                      ))}
                  </div>

                  {editable ? (
                    <form action={addEvaluationV2ItemAction} className="eval-v2-new-item">
                      <input type="hidden" name="template_id" value={template.id} />
                      <input type="hidden" name="version_id" value={version.id} />
                      <input type="hidden" name="block_id" value={activeBlock.id} />
                      <input type="hidden" name="discipline_id" value={template.discipline_id} />

                      <label className="eval-field">
                        <span>
                          {activeBlock.block_type === "weighted_criteria"
                            ? "Nuevo criterio"
                            : activeBlock.block_type === "correct_incorrect"
                              ? "Nuevo nombre / pregunta"
                              : "Nuevo elemento"}
                        </span>
                        <input name="label" placeholder="Nombre" required />
                      </label>
                      <label className="eval-field">
                        <span>Peso dentro del bloque</span>
                        <div className="eval-v2-percent-input">
                          <input
                            name="item_weight_percent"
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            placeholder="Opcional"
                          />
                          <span>%</span>
                        </div>
                      </label>
                      {activeBlock.block_type === "element_list" ? (
                        <label className="eval-v2-check">
                          <input name="scored" type="checkbox" />
                          <span>También tendrá puntuación numérica</span>
                        </label>
                      ) : null}
                      {activeBlock.block_type === "weighted_criteria" ? (
                        <>
                          <input type="hidden" name="scored" value="on" />
                          <input type="hidden" name="max_score" value="100" />
                        </>
                      ) : null}
                      <label className="eval-v2-check">
                        <input name="progression_required" type="checkbox" />
                        <span>Requisito para progresión</span>
                      </label>
                      <button className="eval-v2-add-button" type="submit">
                        + Agregar elemento
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : (
                <div className="eval-notice">
                  Durante la evaluación el coach capturará una puntuación de 0 a 100 para este
                  bloque.
                </div>
              )}

              {editable ? (
                <form action={deleteEvaluationV2BlockAction} className="eval-form-actions">
                  <input type="hidden" name="template_id" value={template.id} />
                  <input type="hidden" name="version_id" value={version.id} />
                  <input type="hidden" name="block_id" value={activeBlock.id} />
                  <button className="eval-danger-button" type="submit">
                    Eliminar bloque
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {step === "revision" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <span className="eval-step-label">Revisión</span>
              <h2>{ready ? "Configuración lista" : "Falta completar la configuración"}</h2>
              <p>Studio Flow valida la estructura antes de permitir nuevas evaluaciones.</p>
            </div>
            <span className={`eval-status ${ready ? "approved" : "incomplete"}`}>
              {ready ? "Lista" : "Pendiente"}
            </span>
          </header>

          <div className="eval-v2-review-list">
            <article>
              <span>Peso total de bloques</span>
              <strong>{totalWeight}% {Math.abs(totalWeight - 100) <= 0.01 ? "✓" : ""}</strong>
            </article>
            <article>
              <span>Mínimo global</span>
              <strong>{version.pass_threshold}%</strong>
            </article>
            {blocks.map((block) => {
              const validation = blockValidation.find((item) => item.id === block.id);
              return (
                <article key={block.id}>
                  <span>{block.label} · {blockTypeLabel(block.block_type)}</span>
                  <strong>{validation?.valid ? "Completo ✓" : "Revisar"}</strong>
                </article>
              );
            })}
          </div>

          <div className="eval-notice">
            Al activar, los cambios aplicarán sólo a evaluaciones nuevas. Las evaluaciones anteriores
            y las que ya estén en curso conservan su configuración.
          </div>

          <div className="eval-form-actions eval-v2-nav-actions">
            <Link className="eval-secondary-button" href={editorUrl(template.id, "bloques")}>
              ← Anterior
            </Link>
            {editable ? (
              <form action={activateEvaluationV2Action}>
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <input type="hidden" name="discipline_id" value={template.discipline_id} />
                <button className="eval-primary-button" type="submit" disabled={!ready}>
                  Activar evaluación
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function editorUrl(templateId: string, step: EditorStep, blockId?: string) {
  const params = new URLSearchParams({ step });
  if (blockId) params.set("block", blockId);
  return `/admin/evaluaciones/v2/${templateId}?${params.toString()}`;
}
