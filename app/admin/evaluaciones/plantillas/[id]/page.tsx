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

const errorCopy: Record<string, string> = {
  criteria: "No pudimos actualizar las ponderaciones.",
  settings: "No pudimos actualizar las reglas.",
  element: "No pudimos agregar el elemento.",
  combo: "No pudimos agregar el combo.",
  activate: "Para activar, la ponderación debe sumar 100% y debe existir al menos un elemento.",
  version: "No pudimos crear una nueva versión.",
};

export default async function EvaluationTemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
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

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link
            className="back-link compact"
            href={`/admin/evaluaciones/configuracion/${template.discipline_id}?view=plantillas`}
          >
            ← {discipline?.name ?? "Disciplina"}
          </Link>
          <h1>Editar plantilla</h1>
          <p>Personaliza criterios, figuras y reglas sin alterar el historial.</p>
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
          {errorCopy[qs.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>{template.name}</h2>
            <p>
              {discipline?.name ?? "Disciplina"} · {level?.title ?? "Nivel técnico"} · Versión{" "}
              {version.version_number}
            </p>
          </div>
          {used ? <span className="eval-status">Usada en evaluaciones</span> : null}
        </header>

        {!editable ? (
          <div className="eval-notice">
            Esta versión ya forma parte del historial y está bloqueada. Crea una nueva versión para
            cambiar criterios, elementos o reglas.
          </div>
        ) : null}

        {used ? (
          <form action={createNextEvaluationTemplateVersion} className="eval-form-actions">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-primary-button" type="submit">
              + Crear nueva versión
            </button>
          </form>
        ) : null}
      </section>

      <nav className="eval-tabs" aria-label="Editor de plantilla">
        <a className="is-active" href="#criterios">
          Criterios
        </a>
        <a href="#figuras">Figuras</a>
        <a href="#combos">Combos</a>
        <a href="#reglas">Reglas</a>
        <a href="#instrucciones">Instrucciones</a>
      </nav>

      <section className="eval-panel eval-config-section" id="criterios">
        <header>
          <div>
            <h2>Criterios y ponderaciones</h2>
            <p>La suma debe ser exactamente 100% para activar la plantilla.</p>
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
              <article className="eval-discipline-row" key={criterion.id}>
                <span className="eval-discipline-icon" aria-hidden="true">
                  ▥
                </span>
                <span className="eval-discipline-copy">
                  <strong>{criterion.label}</strong>
                  <small>{criterion.description}</small>
                </span>
                <label className="eval-field">
                  <span style={{ display: "none" }}>Peso</span>
                  <input
                    name={`weight_${criterion.id}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={criterion.weight_percent}
                    disabled={!editable}
                    aria-label={`Peso de ${criterion.label}`}
                  />
                </label>
                <label className="eval-field">
                  <span style={{ display: "none" }}>Mínimo</span>
                  <input
                    name={`min_${criterion.id}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={criterion.min_percent ?? version.default_category_min}
                    disabled={!editable}
                    aria-label={`Mínimo de ${criterion.label}`}
                  />
                </label>
              </article>
            ))}
          </div>
          {editable ? (
            <div className="eval-form-actions">
              <button className="eval-primary-button" type="submit">
                Guardar criterios
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="eval-panel eval-config-section" id="figuras">
        <header>
          <div>
            <h2>Figuras y elementos</h2>
            <p>Define lo que se capturará durante la evaluación en vivo.</p>
          </div>
        </header>

        {elements.length ? (
          <div className="eval-discipline-list">
            {elements.map((item) => {
              const snapshot =
                typeof item.element_snapshot === "object" && item.element_snapshot
                  ? (item.element_snapshot as Record<string, unknown>)
                  : {};
              return (
                <article className="eval-discipline-row" key={item.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ★
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{String(snapshot.name ?? "Elemento técnico")}</strong>
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
              );
            })}
          </div>
        ) : (
          <div className="eval-empty">Todavía no hay figuras o elementos en esta versión.</div>
        )}

        {editable ? (
          <form action={addEvaluationElement} className="eval-form" style={{ marginTop: 14 }}>
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
              <button className="eval-primary-button" type="submit">
                + Agregar elemento
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="eval-panel eval-config-section" id="combos">
        <header>
          <div>
            <h2>Combos</h2>
            <p>Los combos son requisito complementario por defecto y pueden ser obligatorios.</p>
          </div>
        </header>

        {combos.length ? (
          <div className="eval-discipline-list">
            {combos.map((item) => {
              const snapshot =
                typeof item.combo_snapshot === "object" && item.combo_snapshot
                  ? (item.combo_snapshot as Record<string, unknown>)
                  : {};
              return (
                <article className="eval-discipline-row" key={item.id}>
                  <span className="eval-discipline-icon" aria-hidden="true">
                    ↗
                  </span>
                  <span className="eval-discipline-copy">
                    <strong>{String(snapshot.name ?? "Combo técnico")}</strong>
                    <small>
                      {item.scored ? `Puntuable · / ${item.max_score}` : "Requisito complementario"}
                    </small>
                  </span>
                  <span className={`eval-status ${item.mandatory ? "stays" : ""}`}>
                    {item.mandatory ? "Obligatorio" : "Opcional"}
                  </span>
                  <span />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="eval-empty">Todavía no hay combos en esta versión.</div>
        )}

        {editable ? (
          <form action={addEvaluationCombo} className="eval-form" style={{ marginTop: 14 }}>
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
              <button className="eval-primary-button" type="submit">
                + Agregar combo
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="eval-panel eval-config-section" id="reglas">
        <header>
          <div>
            <h2>Reglas del nivel</h2>
            <p>Define umbrales, intentos e instrucciones para el evaluador.</p>
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
          <div className="eval-field" id="instrucciones">
            <label htmlFor="instructions">Instrucciones para el evaluador</label>
            <textarea
              id="instructions"
              name="instructions"
              defaultValue={version.evaluator_instructions ?? ""}
              placeholder="Prioriza control, seguridad y ejecución limpia…"
              disabled={!editable}
            />
          </div>
          {editable ? (
            <div className="eval-form-actions">
              <button className="eval-primary-button" type="submit">
                Guardar reglas
              </button>
            </div>
          ) : null}
        </form>
      </section>

      {version.status === "draft" ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Activar plantilla</h2>
              <p>Una vez activa podrá usarse para crear evaluaciones.</p>
            </div>
          </header>
          <form action={activateEvaluationTemplateVersion} className="eval-form-actions">
            <input type="hidden" name="template_id" value={template.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <button className="eval-primary-button" type="submit">
              Activar versión {version.version_number}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
