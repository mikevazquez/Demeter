"use client";

import { useMemo, useState, useTransition } from "react";

import {
  saveTechnicalComboResultAction,
  saveTechnicalCriterionResultAction,
  saveTechnicalElementResultAction,
} from "./actions";

type CriterionLive = {
  id: string;
  label: string;
  weightPercent: number;
  minPercent: number;
  scorePercent: number | null;
  notes: string;
  captured: boolean;
};

type LiveItem = {
  id: string;
  criterionId: string | null;
  name: string;
  description?: string | null;
  mandatory: boolean;
  scored: boolean;
  maxScore: number;
  attemptsAllowed: number;
  resultStatus: string;
  score: number | null;
  attemptCount: number;
  notes: string;
};

function CriterionScoreEditor({
  evaluationId,
  criterion,
}: {
  evaluationId: string;
  criterion: CriterionLive;
}) {
  const [score, setScore] = useState(
    criterion.scorePercent === null ? "" : String(criterion.scorePercent),
  );
  const [notes, setNotes] = useState(criterion.notes);
  const [message, setMessage] = useState(criterion.captured ? "Guardado" : "");
  const [isPending, startTransition] = useTransition();

  function save(nextNotes = notes) {
    if (score === "") {
      setMessage("Captura una puntuación");
      return;
    }
    const formData = new FormData();
    formData.set("evaluation_id", evaluationId);
    formData.set("template_criterion_id", criterion.id);
    formData.set("score_percent", score);
    formData.set("notes", nextNotes);

    startTransition(async () => {
      const result = await saveTechnicalCriterionResultAction(formData);
      setMessage(result.ok ? "Guardado" : "No se pudo guardar");
    });
  }

  return (
    <section className="eval-panel eval-config-section">
      <header>
        <div>
          <span className="eval-step-label">Calificación general</span>
          <h2>{criterion.label}</h2>
          <p>
            Peso {criterion.weightPercent}% · mínimo {criterion.minPercent}%
          </p>
        </div>
        <span className={"eval-status " + (criterion.captured ? "approved" : "incomplete")}>
          {criterion.captured ? "Capturado" : "Pendiente"}
        </span>
      </header>

      <div className="eval-field-grid">
        <div className="eval-field">
          <label htmlFor={"criterion-score-" + criterion.id}>Puntuación · 0 a 100</label>
          <input
            id={"criterion-score-" + criterion.id}
            aria-label={"Puntuación de " + criterion.label}
            type="number"
            min="0"
            max="100"
            step="1"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            onBlur={() => save()}
            placeholder="/ 100"
          />
        </div>
        <div className="eval-field">
          <label htmlFor={"criterion-notes-" + criterion.id}>Observaciones del criterio</label>
          <textarea
            id={"criterion-notes-" + criterion.id}
            aria-label={"Observaciones de " + criterion.label}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => save()}
            placeholder={"Observaciones sobre " + criterion.label.toLowerCase() + "…"}
          />
        </div>
      </div>

      <small style={{ color: isPending ? "#ff65b3" : "#748193", fontSize: 8 }}>
        {isPending ? "Guardando…" : message || "Autoguardado activo"}
      </small>
    </section>
  );
}

function ResultEditor({
  evaluationId,
  item,
  kind,
}: {
  evaluationId: string;
  item: LiveItem;
  kind: "element" | "combo";
}) {
  const [status, setStatus] = useState(item.resultStatus);
  const [score, setScore] = useState(item.score === null ? "" : String(item.score));
  const [attemptCount, setAttemptCount] = useState(String(item.attemptCount || 0));
  const [notes, setNotes] = useState(item.notes);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(nextStatus = status, nextNotes = notes) {
    const formData = new FormData();
    formData.set("evaluation_id", evaluationId);
    formData.set(kind === "element" ? "template_element_id" : "template_combo_id", item.id);
    formData.set("result_status", nextStatus);
    formData.set("score", score);
    formData.set("attempt_count", attemptCount);
    formData.set("notes", nextNotes);

    startTransition(async () => {
      const result =
        kind === "element"
          ? await saveTechnicalElementResultAction(formData)
          : await saveTechnicalComboResultAction(formData);
      setMessage(result.ok ? "Guardado" : "No se pudo guardar");
    });
  }

  function choose(nextStatus: string) {
    setStatus(nextStatus);
    save(nextStatus);
  }

  function addQuickComment(comment: string) {
    const nextNotes = notes ? `${notes} · ${comment}` : comment;
    setNotes(nextNotes);
    save(status, nextNotes);
  }

  return (
    <article className="eval-element-card">
      <div className="eval-element-copy">
        <strong>{item.name}</strong>
        {item.description ? <small>{item.description}</small> : null}
        {item.mandatory ? <span className="eval-mandatory">Requisito para progresión</span> : null}
        <small>
          {item.scored ? `Puntuación / ${item.maxScore}` : "Requisito complementario"} ·{" "}
          {item.attemptsAllowed} intentos
        </small>
      </div>

      <div className="eval-result-controls">
        <div className="eval-choice-row">
          <button
            type="button"
            className={`eval-choice ${status === "meets" ? "is-selected" : ""}`}
            onClick={() => choose("meets")}
          >
            ✓ Cumple
          </button>
          <button
            type="button"
            className={`eval-choice ${status === "does_not_meet" ? "is-selected" : ""}`}
            onClick={() => choose("does_not_meet")}
          >
            No cumple
          </button>
          <button
            type="button"
            className={`eval-choice ${status === "not_evaluated" ? "is-selected" : ""}`}
            onClick={() => choose("not_evaluated")}
          >
            No evaluado
          </button>
        </div>

        <div className="eval-score-row">
          {item.scored ? (
            <input
              aria-label={`Puntuación de ${item.name}`}
              type="number"
              min="0"
              max={item.maxScore}
              step="0.1"
              value={score}
              onChange={(event) => setScore(event.target.value)}
              onBlur={() => save()}
              placeholder={`/ ${item.maxScore}`}
            />
          ) : (
            <input value="—" aria-label="Sin puntuación" readOnly />
          )}
          <textarea
            aria-label={`Notas de ${item.name}`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => save()}
            placeholder="Agregar observaciones…"
          />
        </div>

        <div className="eval-choice-row">
          <button
            type="button"
            className="eval-choice"
            onClick={() => addQuickComment("Buen control")}
          >
            Buen control
          </button>
          <button
            type="button"
            className="eval-choice"
            onClick={() => addQuickComment("Evitar impulso")}
          >
            Evitar impulso
          </button>
          <label className="eval-choice" style={{ display: "grid", placeItems: "center" }}>
            Intentos
            <input
              aria-label={`Intentos de ${item.name}`}
              type="number"
              min="0"
              max={item.attemptsAllowed}
              value={attemptCount}
              onChange={(event) => setAttemptCount(event.target.value)}
              onBlur={() => save()}
              style={{ width: 36, background: "transparent", border: 0, color: "white" }}
            />
          </label>
        </div>

        <small style={{ color: isPending ? "#ff65b3" : "#748193", fontSize: 8 }}>
          {isPending ? "Guardando…" : message || "Autoguardado activo"}
        </small>
      </div>
    </article>
  );
}

export function EvaluationLiveForm({
  evaluationId,
  criteria,
  elements,
  combos,
}: {
  evaluationId: string;
  criteria: CriterionLive[];
  elements: LiveItem[];
  combos: LiveItem[];
}) {
  const [activeCriterionId, setActiveCriterionId] = useState(criteria[0]?.id ?? null);
  const activeCriterion =
    criteria.find((criterion) => criterion.id === activeCriterionId) ?? criteria[0] ?? null;

  const criterionElements = useMemo(
    () => elements.filter((item) => item.criterionId === activeCriterion?.id),
    [elements, activeCriterion?.id],
  );
  const criterionCombos = useMemo(
    () => combos.filter((item) => item.criterionId === activeCriterion?.id),
    [combos, activeCriterion?.id],
  );
  const unassignedElements = elements.filter((item) => !item.criterionId);
  const unassignedCombos = combos.filter((item) => !item.criterionId);

  return (
    <div className="eval-element-list">
      <div className="eval-criteria-tabs" role="tablist" aria-label="Criterios de evaluación">
        {criteria.map((criterion) => (
          <button
            type="button"
            role="tab"
            aria-selected={criterion.id === activeCriterion?.id}
            className={
              "eval-criterion-tab " + (criterion.id === activeCriterion?.id ? "is-active" : "")
            }
            key={criterion.id}
            onClick={() => setActiveCriterionId(criterion.id)}
          >
            <strong>{criterion.label}</strong>
            <small>
              {criterion.scorePercent === null
                ? "Sin calificar"
                : Math.round(criterion.scorePercent) + "%"}{" "}
              · peso {criterion.weightPercent}%
            </small>
          </button>
        ))}
      </div>

      {activeCriterion ? (
        <>
          <CriterionScoreEditor evaluationId={evaluationId} criterion={activeCriterion} />

          {criterionElements.length || criterionCombos.length ? (
            <section className="eval-panel eval-config-section">
              <header>
                <div>
                  <h2>Elementos de {activeCriterion.label}</h2>
                  <p>Evalúa las figuras y combos asociados a este criterio.</p>
                </div>
              </header>
              <div className="eval-element-list">
                {criterionElements.map((item) => (
                  <ResultEditor
                    key={item.id}
                    evaluationId={evaluationId}
                    item={item}
                    kind="element"
                  />
                ))}
                {criterionCombos.map((item) => (
                  <ResultEditor
                    key={item.id}
                    evaluationId={evaluationId}
                    item={item}
                    kind="combo"
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="eval-notice">
              Este criterio no tiene figuras o combos asociados. Captura su calificación general
              para continuar.
            </div>
          )}
        </>
      ) : null}

      {unassignedElements.length || unassignedCombos.length ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>Requisitos generales</h2>
              <p>Elementos técnicos que no pertenecen a un criterio específico.</p>
            </div>
          </header>
          <div className="eval-element-list">
            {unassignedElements.map((item) => (
              <ResultEditor key={item.id} evaluationId={evaluationId} item={item} kind="element" />
            ))}
            {unassignedCombos.map((item) => (
              <ResultEditor key={item.id} evaluationId={evaluationId} item={item} kind="combo" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

