"use client";

import { useMemo, useState, useTransition } from "react";

import {
  saveTechnicalCriterionResultAction,
  saveTechnicalElementResultAction,
} from "./actions";

export type EvaluationV2ItemLive = {
  id: string;
  name: string;
  description?: string | null;
  scored: boolean;
  maxScore: number;
  minScore: number | null;
  weightPercent: number | null;
  progressionRequired: boolean;
  resultStatus: string;
  score: number | null;
  attemptCount: number;
  attemptsAllowed: number;
  notes: string;
};

export type EvaluationV2BlockLive = {
  id: string;
  label: string;
  description?: string | null;
  blockType: string;
  weightPercent: number;
  minPercent: number | null;
  progressionRequired: boolean;
  instructions?: string | null;
  scorePercent: number | null;
  notes: string;
  captured: boolean;
  items: EvaluationV2ItemLive[];
};

function typeCopy(value: string) {
  const copy: Record<string, string> = {
    direct_score: "Puntuación directa",
    weighted_criteria: "Varios criterios",
    element_list: "Lista de elementos",
    correct_incorrect: "Correcto / Incorrecto",
    meets: "Cumple / No cumple",
  };
  return copy[value] ?? value;
}

function isItemComplete(item: EvaluationV2ItemLive) {
  if (item.resultStatus === "not_evaluated") return false;
  if (item.scored && item.score === null) return false;
  return true;
}

function blockComplete(block: EvaluationV2BlockLive) {
  if (block.blockType === "direct_score") return block.captured;
  return block.items.length > 0 && block.items.every(isItemComplete);
}

function DirectScoreEditor({
  evaluationId,
  block,
}: {
  evaluationId: string;
  block: EvaluationV2BlockLive;
}) {
  const [score, setScore] = useState(block.scorePercent === null ? "" : String(block.scorePercent));
  const [notes, setNotes] = useState(block.notes);
  const [message, setMessage] = useState(block.captured ? "Guardado" : "");
  const [isPending, startTransition] = useTransition();

  function save(nextNotes = notes) {
    if (score === "") {
      setMessage("Captura una puntuación");
      return;
    }

    const formData = new FormData();
    formData.set("evaluation_id", evaluationId);
    formData.set("template_criterion_id", block.id);
    formData.set("score_percent", score);
    formData.set("notes", nextNotes);

    startTransition(async () => {
      const result = await saveTechnicalCriterionResultAction(formData);
      setMessage(result.ok ? "Guardado" : result.message || "No se pudo guardar");
    });
  }

  return (
    <div className="eval-v2-live-direct">
      <label className="eval-field">
        <span>Puntuación · 0 a 100</span>
        <div className="eval-v2-score-input">
          <input
            aria-label={`Puntuación de ${block.label}`}
            type="number"
            min="0"
            max="100"
            step="1"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            onBlur={() => save()}
            placeholder="0"
          />
          <span>/ 100</span>
        </div>
      </label>
      <label className="eval-field">
        <span>Observaciones del bloque</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => save()}
          placeholder="Observaciones opcionales…"
        />
      </label>
      <small className="eval-v2-autosave">
        {isPending ? "Guardando…" : message || "Autoguardado activo"}
      </small>
    </div>
  );
}

function V2ItemEditor({
  evaluationId,
  item,
  blockType,
}: {
  evaluationId: string;
  item: EvaluationV2ItemLive;
  blockType: string;
}) {
  const [status, setStatus] = useState(item.resultStatus);
  const [score, setScore] = useState(item.score === null ? "" : String(item.score));
  const [attemptCount, setAttemptCount] = useState(String(item.attemptCount || 0));
  const [notes, setNotes] = useState(item.notes);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(nextStatus = status, nextNotes = notes, nextScore = score) {
    const formData = new FormData();
    formData.set("evaluation_id", evaluationId);
    formData.set("template_element_id", item.id);
    formData.set("result_status", nextStatus);
    formData.set("score", nextScore);
    formData.set("attempt_count", attemptCount);
    formData.set("notes", nextNotes);

    startTransition(async () => {
      const result = await saveTechnicalElementResultAction(formData);
      setMessage(result.ok ? "Guardado" : result.message || "No se pudo guardar");
    });
  }

  function choose(nextStatus: "meets" | "does_not_meet") {
    setStatus(nextStatus);
    save(nextStatus);
  }

  function saveNumeric() {
    if (score === "") {
      setMessage("Captura una puntuación");
      return;
    }
    if (status === "not_evaluated") setStatus("meets");
    save("meets");
  }

  const correctLabels = blockType === "correct_incorrect";
  const weighted = blockType === "weighted_criteria";

  return (
    <article className="eval-v2-live-item">
      <div className="eval-v2-live-item-copy">
        <strong>{item.name}</strong>
        {item.description ? <small>{item.description}</small> : null}
        <div className="eval-v2-item-meta">
          {item.weightPercent !== null ? <span>{item.weightPercent}% del bloque</span> : null}
          {item.progressionRequired ? (
            <span className="eval-v2-requirement">Requisito para progresión</span>
          ) : null}
        </div>
      </div>

      {weighted ? (
        <div className="eval-v2-score-input compact">
          <input
            aria-label={`Puntuación de ${item.name}`}
            type="number"
            min="0"
            max={item.maxScore}
            step="1"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            onBlur={saveNumeric}
            placeholder="0"
          />
          <span>/ {item.maxScore}</span>
        </div>
      ) : (
        <div className="eval-choice-row">
          <button
            type="button"
            className={`eval-choice ${status === "meets" ? "is-selected" : ""}`}
            onClick={() => choose("meets")}
          >
            {correctLabels ? "✓ Correcto" : "✓ Cumple"}
          </button>
          <button
            type="button"
            className={`eval-choice ${status === "does_not_meet" ? "is-selected" : ""}`}
            onClick={() => choose("does_not_meet")}
          >
            {correctLabels ? "Incorrecto" : "No cumple"}
          </button>
        </div>
      )}

      {item.scored && !weighted ? (
        <div className="eval-v2-score-input compact">
          <input
            aria-label={`Puntuación de ${item.name}`}
            type="number"
            min="0"
            max={item.maxScore}
            step="0.1"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            onBlur={() => save()}
            placeholder="0"
          />
          <span>/ {item.maxScore}</span>
        </div>
      ) : null}

      <div className="eval-v2-live-item-detail">
        {item.attemptsAllowed > 0 ? (
          <label className="eval-v2-attempts">
            <span>Intentos</span>
            <input
              type="number"
              min="0"
              max={item.attemptsAllowed}
              value={attemptCount}
              onChange={(event) => setAttemptCount(event.target.value)}
              onBlur={() => save()}
            />
            <small>/ {item.attemptsAllowed}</small>
          </label>
        ) : null}
        <label className="eval-field">
          <span>Observación</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => save(status, event.currentTarget.value)}
            placeholder="Opcional…"
          />
        </label>
      </div>

      <small className="eval-v2-autosave">
        {isPending ? "Guardando…" : message || (isItemComplete({ ...item, resultStatus: status, score: score === "" ? null : Number(score) }) ? "Capturado" : "Pendiente")}
      </small>
    </article>
  );
}

export function EvaluationLiveFormV2({
  evaluationId,
  blocks,
}: {
  evaluationId: string;
  blocks: EvaluationV2BlockLive[];
}) {
  const [activeBlockId, setActiveBlockId] = useState(blocks[0]?.id ?? null);
  const activeBlock = blocks.find((block) => block.id === activeBlockId) ?? blocks[0] ?? null;

  const completedCount = useMemo(() => blocks.filter(blockComplete).length, [blocks]);

  return (
    <div className="eval-v2-live-layout">
      <aside className="eval-v2-live-nav" aria-label="Bloques de evaluación">
        <div className="eval-v2-live-nav-progress">
          <strong>
            {completedCount} de {blocks.length}
          </strong>
          <span>bloques completados</span>
        </div>
        {blocks.map((block, index) => (
          <button
            type="button"
            key={block.id}
            className={block.id === activeBlock?.id ? "is-active" : ""}
            onClick={() => setActiveBlockId(block.id)}
          >
            <span className={blockComplete(block) ? "is-complete" : ""}>
              {blockComplete(block) ? "✓" : index + 1}
            </span>
            <strong>{block.label}</strong>
          </button>
        ))}
      </aside>

      {activeBlock ? (
        <section className="eval-panel eval-config-section eval-v2-live-block">
          <header>
            <div>
              <span className="eval-step-label">{typeCopy(activeBlock.blockType)}</span>
              <h2>{activeBlock.label}</h2>
              <p>
                {activeBlock.weightPercent}% de la evaluación
                {activeBlock.minPercent !== null ? ` · mínimo ${activeBlock.minPercent}%` : ""}
              </p>
            </div>
            <span className={`eval-status ${blockComplete(activeBlock) ? "approved" : "incomplete"}`}>
              {blockComplete(activeBlock) ? "Completo" : "Pendiente"}
            </span>
          </header>

          {activeBlock.instructions ? (
            <div className="eval-notice">{activeBlock.instructions}</div>
          ) : null}

          {activeBlock.blockType === "direct_score" ? (
            <DirectScoreEditor evaluationId={evaluationId} block={activeBlock} />
          ) : (
            <div className="eval-v2-live-items">
              {activeBlock.items.map((item) => (
                <V2ItemEditor
                  key={item.id}
                  evaluationId={evaluationId}
                  item={item}
                  blockType={activeBlock.blockType}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="eval-empty">Esta evaluación todavía no tiene bloques configurados.</div>
      )}
    </div>
  );
}
