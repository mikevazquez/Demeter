import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  activateEvaluationTemplateVersion,
  addEvaluationCombo,
  addEvaluationElement,
  createNextEvaluationTemplateVersion,
  updateEvaluationCriteria,
  updateEvaluationTemplateSettings,
} from "../../actions";

type EditorStep = "criterios" | "figuras" | "combos" | "reglas" | "resumen";

const errorCopy: Record<string, string> = {
  criteria: "No pudimos guardar los criterios. Inténtalo de nuevo.",
  criteria_total: "La ponderación de los criterios debe sumar exactamente 100%.",
  settings: "No pudimos actualizar las reglas.",
  element: "No pudimos agregar el elemento.",
  combo: "No pudimos agregar el combo.",
  activate: "Para activar, la ponderación debe sumar 100% y debe existir al menos un elemento.",
  version: "No pudimos crear una nueva versión.",
};

function resolveStep(value: string | undefined, status: string): EditorStep {
  if (
    value === "criterios" ||
    value === "figuras" ||
    value === "combos" ||
    value === "reglas" ||
    value === "resumen"
  ) {
    return value;
  }

  return status === "draft" ? "criterios" : "resumen";
}

function snapshot(value: unknown, fallback: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallback;
  }

  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name ? name : fallback;
}

export default async function EvaluationTemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  const { id } = await params;
  const qs = await searchParams;
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
        "id,version_number,status,pass_threshold,default_category_min,default_attempts_per_element,default_attempts_per_combo,evaluator_instructions,updated_at",
      )
      .eq("template_id", template.id)
      .eq("studio_id", ctx.studio.id)
      .order("version_number", { ascending: false }),
  ]);

  const version = versions?.[0];
  if (!version) notFound();

  const step = resolveStep(qs.step, version.status);

  const { data: level } = levelLink?.technical_level_id
    ? await ctx.supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("id", levelLink.technical_level_id)
        .single()
    : { data: null };

  const [criteriaResult, elementsResult, combosResult, usedResult] = await Promise.all([
    ctx.supabase
      .from("evaluation_template_criteria")
      .select("id,criterion_key,label,description,weight_percent,min_percent,sort_order")
      .eq("template_version_id", version.id)
      .order("sort_order"),
    ctx.supabase
      .from("evaluation_template_elements")
      .select(
        "id,element_id,criterion_id,mandatory,scored,max_score,min_score,attempts_allowed,sort_order,element_snapshot",
      )
      .eq("template_version_id", version.id)
      .order("sort_order"),
    ctx.supabase
      .from("evaluation_template_combos")
      .select(
        "id,combo_id,criterion_id,mandatory,scored,max_score,min_score,attempts_allowed,sort_order,combo_snapshot",
      )
      .eq("template_version_id", version.id)
      .order("sort_order"),
    ctx.supabase
      .from("technical_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("template_version_id", version.id),
  ]);

  const criteria = criteriaResult.data ?? [];
  const elements = elementsResult.data ?? [];
  const combos = combosResult.data ?? [];
  const used = (usedResult.count ?? 0) > 0;
  const editable = version.status === "draft" || (version.status === "active" && !used);
  const weightTotal = criteria.reduce((sum, item) => sum + Number(item.weight_percent ?? 0), 0);
  const levelTitle = level?.title ?? "Nivel técnico";

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
          <h1>Configurar {levelTitle}</h1>
          <p>
            {discipline?.name ?? "Disciplina"} · {template.name} · Versión {version.version_number}
          </p>
        </div>

        <span className={`eval-status ${version.status === "active" ? "approved" : ""}`}>
          {version.status === "active"
            ? "Activa"
            : version.status === "archived"
              ? "Archivada"
              : "Borrador"}
        </span>
      </header>

      {qs.error ? (
        <div className="eval-notice">
          {errorCopy[qs.error] ?? "No pudimos completar la acción."}
        </div>
      ) : null}

      {!editable ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Versión protegida</h2>
              <p>
                Esta versión ya forma parte del historial. Para modificarla, crea una nueva versión.
              </p>
            </div>
          </header>

          <form action={createNextEvaluationTemplateVersion} className="eval-form-actions">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-primary-button" type="submit">
              + Crear nueva versión
            </button>
          </form>
        </section>
      ) : null}

      {step === "criterios" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <small className="eval-step-label">Paso 1 de 5</small>
              <h2>Criterios y ponderaciones</h2>
              <p>
                Define cómo se calificará {levelTitle}. La suma de los pesos debe ser exactamente
                100%.
              </p>
            </div>
            <span className={`eval-status ${weightTotal === 100 ? "approved" : "incomplete"}`}>
              Total {weightTotal}%
            </span>
          </header>

          <form action={updateEvaluationCriteria} className="eval-form">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />

            <div className="eval-discipline-list">
              {criteria.map((criterion) => (
                <article className="eval-criterion-editor-row" key={criterion.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ▥
                  </span>

                  <span className="eval-discipline-copy">
                    <strong>{criterion.label}</strong>
                    <small>{criterion.description}</small>
                  </span>

                  <label className="eval-field">
                    <span>Peso (%)</span>
                    <input
                      name={`weight_${criterion.id}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={criterion.weight_percent}
                      disabled={!editable}
                    />
                  </label>

                  <label className="eval-field">
                    <span>Mínimo (%)</span>
                    <input
                      name={`min_${criterion.id}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={criterion.min_percent ?? version.default_category_min}
                      disabled={!editable}
                    />
                  </label>
                </article>
              ))}
            </div>

            {editable ? (
              <div className="eval-form-actions">
                <button className="eval-primary-button" type="submit">
                  Guardar y continuar →
                </button>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {step === "figuras" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <small className="eval-step-label">Paso 2 de 5</small>
              <h2>Figuras y elementos</h2>
              <p>Agrega las figuras, habilidades, transiciones o nomenclatura de este nivel.</p>
            </div>
          </header>

          {elements.length ? (
            <div className="eval-discipline-list">
              {elements.map((item) => (
                <article className="eval-discipline-row" key={item.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ★
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{snapshot(item.element_snapshot, "Elemento técnico")}</strong>
                    <small>
                      {item.scored ? `Puntuable · / ${item.max_score}` : "No puntuable"} ·{" "}
                      {item.attempts_allowed ?? version.default_attempts_per_element} intentos
                    </small>
                  </span>
                  <span className={`eval-status ${item.mandatory ? "stays" : ""}`}>
                    {item.mandatory ? "Obligatorio" : "Opcional"}
                  </span>
                  <span />
                </article>
              ))}
            </div>
          ) : (
            <div className="eval-empty">Todavía no hay figuras o elementos en este nivel.</div>
          )}

          {editable ? (
            <form action={addEvaluationElement} className="eval-form eval-step-form">
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="discipline_id" value={template.discipline_id} />

              <div className="eval-field-grid">
                <div className="eval-field">
                  <label htmlFor="element-name">Nombre del elemento</label>
                  <input id="element-name" name="name" placeholder="Invert básica" required />
                </div>

                <div className="eval-field">
                  <label htmlFor="element-criterion">Criterio</label>
                  <select id="element-criterion" name="criterion_id" required defaultValue="">
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {criteria.map((criterion) => (
                      <option value={criterion.id} key={criterion.id}>
                        {criterion.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="eval-field">
                  <label htmlFor="element-kind">Tipo</label>
                  <select id="element-kind" name="kind" defaultValue="figure">
                    <option value="figure">Figura</option>
                    <option value="skill">Habilidad</option>
                    <option value="transition">Transición</option>
                    <option value="theory">Teoría / nomenclatura</option>
                  </select>
                </div>

                <div className="eval-field">
                  <label htmlFor="element-attempts">Intentos</label>
                  <input
                    id="element-attempts"
                    name="attempts"
                    type="number"
                    min="1"
                    defaultValue={version.default_attempts_per_element}
                  />
                </div>
              </div>

              <div className="eval-form-actions">
                <label>
                  <input type="checkbox" name="mandatory" /> Obligatorio
                </label>
                <input type="hidden" name="scored" value="on" />
                <input type="hidden" name="max_score" value="10" />
                <button className="eval-secondary-button" type="submit">
                  + Agregar elemento
                </button>
              </div>
            </form>
          ) : null}

          <div className="eval-form-actions eval-step-actions">
            <Link
              className="eval-secondary-button"
              href={`/admin/evaluaciones/plantillas/${template.id}?step=criterios`}
            >
              ← Criterios
            </Link>
            <Link
              className="eval-primary-button"
              href={`/admin/evaluaciones/plantillas/${template.id}?step=combos`}
            >
              Continuar →
            </Link>
          </div>
        </section>
      ) : null}

      {step === "combos" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <small className="eval-step-label">Paso 3 de 5</small>
              <h2>Combos</h2>
              <p>Agrega secuencias obligatorias o complementarias. Si no aplican, continúa.</p>
            </div>
          </header>

          {combos.length ? (
            <div className="eval-discipline-list">
              {combos.map((item) => (
                <article className="eval-discipline-row" key={item.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ↗
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{snapshot(item.combo_snapshot, "Combo técnico")}</strong>
                    <small>
                      {item.scored ? `Puntuable · / ${item.max_score}` : "Requisito complementario"}
                    </small>
                  </span>
                  <span className={`eval-status ${item.mandatory ? "stays" : ""}`}>
                    {item.mandatory ? "Obligatorio" : "Opcional"}
                  </span>
                  <span />
                </article>
              ))}
            </div>
          ) : (
            <div className="eval-empty">Este nivel todavía no tiene combos.</div>
          )}

          {editable ? (
            <form action={addEvaluationCombo} className="eval-form eval-step-form">
              <input type="hidden" name="template_id" value={template.id} />
              <input type="hidden" name="version_id" value={version.id} />
              <input type="hidden" name="discipline_id" value={template.discipline_id} />

              <div className="eval-field-grid">
                <div className="eval-field">
                  <label htmlFor="combo-name">Nombre o secuencia</label>
                  <input
                    id="combo-name"
                    name="name"
                    placeholder="Invert → Gemini → Back Hook"
                    required
                  />
                </div>

                <div className="eval-field">
                  <label htmlFor="combo-criterion">Criterio si puntúa</label>
                  <select id="combo-criterion" name="criterion_id" defaultValue="">
                    <option value="">Sin criterio ponderado</option>
                    {criteria.map((criterion) => (
                      <option value={criterion.id} key={criterion.id}>
                        {criterion.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="eval-form-actions">
                <label>
                  <input type="checkbox" name="mandatory" defaultChecked /> Obligatorio
                </label>
                <label>
                  <input type="checkbox" name="scored" /> Puntuable
                </label>
                <input type="hidden" name="max_score" value="10" />
                <input type="hidden" name="attempts" value={version.default_attempts_per_combo} />
                <button className="eval-secondary-button" type="submit">
                  + Agregar combo
                </button>
              </div>
            </form>
          ) : null}

          <div className="eval-form-actions eval-step-actions">
            <Link
              className="eval-secondary-button"
              href={`/admin/evaluaciones/plantillas/${template.id}?step=figuras`}
            >
              ← Figuras
            </Link>
            <Link
              className="eval-primary-button"
              href={`/admin/evaluaciones/plantillas/${template.id}?step=reglas`}
            >
              Continuar →
            </Link>
          </div>
        </section>
      ) : null}

      {step === "reglas" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <small className="eval-step-label">Paso 4 de 5</small>
              <h2>Reglas e instrucciones</h2>
              <p>Define los mínimos y las indicaciones que aplican a este nivel.</p>
            </div>
          </header>

          <form action={updateEvaluationTemplateSettings} className="eval-form">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />

            <div className="eval-field-grid">
              <div className="eval-field">
                <label htmlFor="pass-threshold">Aprobación global (%)</label>
                <input
                  id="pass-threshold"
                  name="pass_threshold"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={version.pass_threshold}
                  disabled={!editable}
                />
              </div>

              <div className="eval-field">
                <label htmlFor="category-min">Mínimo por criterio (%)</label>
                <input
                  id="category-min"
                  name="category_min"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={version.default_category_min}
                  disabled={!editable}
                />
              </div>

              <div className="eval-field">
                <label htmlFor="attempts-element">Intentos por figura</label>
                <input
                  id="attempts-element"
                  name="attempts_element"
                  type="number"
                  min="1"
                  defaultValue={version.default_attempts_per_element}
                  disabled={!editable}
                />
              </div>

              <div className="eval-field">
                <label htmlFor="attempts-combo">Intentos por combo</label>
                <input
                  id="attempts-combo"
                  name="attempts_combo"
                  type="number"
                  min="1"
                  defaultValue={version.default_attempts_per_combo}
                  disabled={!editable}
                />
              </div>
            </div>

            <div className="eval-field">
              <label htmlFor="instructions">Instrucciones para el evaluador</label>
              <textarea
                id="instructions"
                name="instructions"
                defaultValue={version.evaluator_instructions ?? ""}
                placeholder="Prioriza control, seguridad y ejecución limpia…"
                disabled={!editable}
              />
            </div>

            <div className="eval-form-actions eval-step-actions">
              <Link
                className="eval-secondary-button"
                href={`/admin/evaluaciones/plantillas/${template.id}?step=combos`}
              >
                ← Combos
              </Link>
              {editable ? (
                <button className="eval-primary-button" type="submit">
                  Guardar y continuar →
                </button>
              ) : (
                <Link
                  className="eval-primary-button"
                  href={`/admin/evaluaciones/plantillas/${template.id}?step=resumen`}
                >
                  Continuar →
                </Link>
              )}
            </div>
          </form>
        </section>
      ) : null}

      {step === "resumen" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <small className="eval-step-label">Paso 5 de 5</small>
              <h2>Revisar configuración</h2>
              <p>Confirma que el nivel esté listo antes de activarlo para evaluaciones.</p>
            </div>
          </header>

          <div className="eval-summary-checks">
            <article className="eval-template-card">
              <h3>Criterios</h3>
              <strong>{weightTotal}%</strong>
              <p>{criteria.length} criterios configurados</p>
            </article>
            <article className="eval-template-card">
              <h3>Figuras y elementos</h3>
              <strong>{elements.length}</strong>
              <p>{elements.filter((item) => item.mandatory).length} obligatorios</p>
            </article>
            <article className="eval-template-card">
              <h3>Combos</h3>
              <strong>{combos.length}</strong>
              <p>{combos.filter((item) => item.mandatory).length} obligatorios</p>
            </article>
            <article className="eval-template-card">
              <h3>Regla de aprobación</h3>
              <strong>{version.pass_threshold}%</strong>
              <p>Mínimo por criterio: {version.default_category_min}%</p>
            </article>
          </div>

          {version.evaluator_instructions ? (
            <div className="eval-notice">
              <strong>Instrucciones para el evaluador</strong>
              <br />
              {version.evaluator_instructions}
            </div>
          ) : null}

          <div className="eval-form-actions eval-step-actions">
            <Link
              className="eval-secondary-button"
              href={`/admin/evaluaciones/plantillas/${template.id}?step=reglas`}
            >
              ← Reglas
            </Link>

            {version.status === "draft" ? (
              <form action={activateEvaluationTemplateVersion}>
                <input type="hidden" name="template_id" value={template.id} />
                <input type="hidden" name="version_id" value={version.id} />
                <button className="eval-primary-button" type="submit">
                  Activar nivel
                </button>
              </form>
            ) : (
              <Link
                className="eval-primary-button"
                href={`/admin/evaluaciones/disciplina/${template.discipline_id}`}
              >
                Volver a {discipline?.name ?? "disciplina"}
              </Link>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
