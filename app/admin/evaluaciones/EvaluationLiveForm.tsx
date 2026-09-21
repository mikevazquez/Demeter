"use client";

import { useState, useTransition } from "react";

import { saveTechnicalComboResultAction, saveTechnicalElementResultAction } from "./actions";

type LiveItem = {
  id: string;
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
        {item.mandatory ? (
          <span className="eval-mandatory">Requisito para progresión</span>
        ) : null}
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
  elements,
  combos,
}: {
  evaluationId: string;
  elements: LiveItem[];
  combos: LiveItem[];
}) {
  return (
    <div className="eval-element-list">
      {elements.map((item) => (
        <ResultEditor key={item.id} evaluationId={evaluationId} item={item} kind="element" />
      ))}

      {combos.length ? (
        <>
          <div className="eval-panel-header" style={{ marginTop: 6, paddingInline: 0 }}>
            <h2>Combos</h2>
          </div>
          {combos.map((item) => (
            <ResultEditor key={item.id} evaluationId={evaluationId} item={item} kind="combo" />
          ))}
        </>
      ) : null}
    </div>
  );
}
