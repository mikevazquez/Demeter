"use client";

import { useMemo, useState, useTransition } from "react";

import {
  groupPersonalItems,
  joinFigureNames,
  portalChanges,
  type PersonalItem,
  type PersonalReason,
  type PoleAchievementSnapshot,
  type Readiness,
  type ResultStatus,
  type ScoredFigure,
} from "@/lib/evaluations/pole-adaptive";

import {
  EvaluationLiveFormV2,
  type EvaluationItemHintView,
  type EvaluationV2BlockLive,
} from "./EvaluationLiveFormV2";
import {
  refreshEvaluationPersonalItemsAction,
  saveEvaluationPersonalItemAction,
} from "./pole-actions";

export type PoleWorkspaceData = {
  hints: Record<string, EvaluationItemHintView>;
  baseFigures: Record<
    string,
    { elementId: string; name: string; achievement: PoleAchievementSnapshot | null }
  >;
  personalItems: (PersonalItem & { meta: EvaluationItemHintView[] })[];
  readiness: Readiness;
};

const GROUPS: { reason: PersonalReason; title: string; why: string; empty: string }[] = [
  {
    reason: "pending_previous",
    title: "Pendientes de su evaluación anterior",
    why: "No las cumplió la vez pasada. Si están en la plantilla, se califican arriba.",
    empty: "No tiene pendientes fuera de la plantilla.",
  },
  {
    reason: "self_marked",
    title: "Por validar",
    why: "Las marcó ella en su portal y ninguna instructora las ha visto.",
    empty: "No tiene figuras marcadas sin validar.",
  },
  {
    reason: "next_level",
    title: "Lista para intentar",
    why: "Figuras del siguiente nivel con todos sus pasos previos logrados.",
    empty: "Todavía no tiene figuras del siguiente nivel con sus pasos previos completos.",
  },
];

function PersonalItemRow({
  item,
  status,
  onChange,
}: {
  item: PoleWorkspaceData["personalItems"][number];
  status: ResultStatus;
  onChange: (id: string, status: ResultStatus) => void;
}) {
  const [attempts, setAttempts] = useState(String(item.attemptCount || 0));
  const [notes, setNotes] = useState(item.notes);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(nextStatus: ResultStatus, nextNotes = notes, nextAttempts = attempts) {
    const previous = status;
    onChange(item.id, nextStatus);
    const attemptNumber = Number(nextAttempts);
    startTransition(async () => {
      const result = await saveEvaluationPersonalItemAction(
        item.id,
        nextStatus,
        Number.isFinite(attemptNumber) ? attemptNumber : null,
        nextNotes,
      );
      if (result.ok) {
        setMessage("Guardado");
      } else {
        onChange(item.id, previous);
        setMessage(result.message);
      }
    });
  }

  function choose(next: "meets" | "does_not_meet") {
    save(status === next ? "not_evaluated" : next);
  }

  return (
    <article
      className={`eval-v2-live-item eval-personal-item ${
        status === "meets" ? "is-meets" : status === "does_not_meet" ? "is-not-meets" : ""
      }`}
    >
      <div className="eval-v2-live-item-copy">
        <strong>{item.name}</strong>
        <div className="eval-v2-item-meta">
          {item.figureType ? <span className="eval-hint-note">{item.figureType}</span> : null}
          {item.meta.map((hint) => (
            <span key={hint.label} className={`eval-hint eval-hint-${hint.tone}`}>
              {hint.label}
            </span>
          ))}
          {item.prerequisites.length ? (
            <span className="eval-hint-note">Antes necesita: {item.prerequisites.join(", ")}</span>
          ) : null}
        </div>
      </div>

      <div className="eval-choice-row" role="group" aria-label={item.name}>
        <button
          type="button"
          className={`eval-choice ${status === "meets" ? "is-selected" : ""}`}
          aria-pressed={status === "meets"}
          onClick={() => choose("meets")}
        >
          Cumple
        </button>
        <button
          type="button"
          className={`eval-choice is-negative ${status === "does_not_meet" ? "is-selected" : ""}`}
          aria-pressed={status === "does_not_meet"}
          onClick={() => choose("does_not_meet")}
        >
          No cumple
        </button>
      </div>

      <div className="eval-v2-live-item-detail">
        <label className="eval-v2-attempts">
          <span>Intentos</span>
          <input
            type="number"
            min="0"
            max="3"
            value={attempts}
            onChange={(event) => setAttempts(event.target.value)}
            onBlur={(event) => save(status, notes, event.currentTarget.value)}
          />
          <small>/ 3</small>
        </label>
        <label className="eval-field">
          <span>Observación</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={(event) => save(status, event.currentTarget.value)}
            placeholder="Opcional…"
          />
        </label>
      </div>

      <small className="eval-v2-autosave">
        {isPending
          ? "Guardando…"
          : message || (status === "not_evaluated" ? "Pendiente" : "Capturado")}
      </small>
    </article>
  );
}

export function EvaluationLiveWorkspace({
  evaluationId,
  blocks,
  studentName,
  nextLevelTitle,
  passThreshold,
  pole,
}: {
  evaluationId: string;
  blocks: EvaluationV2BlockLive[];
  studentName: string;
  nextLevelTitle: string | null;
  passThreshold: number;
  pole: PoleWorkspaceData | null;
}) {
  const firstName = studentName.split(" ")[0] || studentName;
  const [baseStatus, setBaseStatus] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      blocks.flatMap((block) => block.items.map((item) => [item.id, item.resultStatus])),
    ),
  );
  const [personalStatus, setPersonalStatus] = useState<Record<string, ResultStatus>>(() =>
    Object.fromEntries((pole?.personalItems ?? []).map((item) => [item.id, item.resultStatus])),
  );

  const baseItems = blocks.flatMap((block) => block.items);
  const baseDone = baseItems.filter((item) => baseStatus[item.id] !== "not_evaluated").length;
  const baseMeets = baseItems.filter((item) => baseStatus[item.id] === "meets").length;
  const personalItems = pole?.personalItems ?? [];
  const personalDone = personalItems.filter(
    (item) => personalStatus[item.id] !== "not_evaluated",
  ).length;
  const groups = groupPersonalItems(personalItems);

  const changes = useMemo(() => {
    if (!pole) return null;
    const scored: ScoredFigure[] = [
      ...Object.entries(pole.baseFigures).map(([itemId, figure]) => ({
        elementId: figure.elementId,
        name: figure.name,
        achievement: figure.achievement,
        status: (baseStatus[itemId] ?? "not_evaluated") as ResultStatus,
      })),
      ...personalItems.map((item) => ({
        elementId: item.elementId,
        name: item.name,
        achievement: item.achievement,
        status: personalStatus[item.id] ?? "not_evaluated",
      })),
    ];
    return portalChanges(scored);
  }, [pole, personalItems, baseStatus, personalStatus]);

  const ready = pole?.readiness;

  return (
    <div className="eval-workspace">
      <div className="eval-workspace-main">
        {ready && ready.baseTotal ? (
          <section className="eval-panel eval-readiness">
            <div className="eval-readiness-head">
              <div>
                <span className="eval-eyebrow">Preparación de {firstName}</span>
                <strong className="eval-big-number">
                  {ready.percent}%<small>de la plantilla ya la tiene lograda</small>
                </strong>
              </div>
              <span
                className={`eval-hint ${
                  ready.verdict === "ready"
                    ? "eval-hint-mint"
                    : ready.verdict === "almost"
                      ? "eval-hint-lilac"
                      : "eval-hint-moon"
                }`}
              >
                {ready.verdict === "ready"
                  ? "Lista para evaluar"
                  : ready.verdict === "almost"
                    ? "Casi lista"
                    : `Le faltan ${ready.baseTotal - ready.baseAchieved} de la plantilla`}
              </span>
            </div>
            <div className="eval-meter" aria-hidden="true">
              <i style={{ width: `${ready.percent}%` }} />
            </div>
            <p className="eval-muted">
              {ready.baseAchieved} de {ready.baseTotal} figuras de la plantilla marcadas en su
              progreso. Las que no tiene se califican igual.
            </p>
          </section>
        ) : null}

        <section className="eval-section">
          <header className="eval-section-head">
            <div>
              <h2>Base del nivel</h2>
              <p>Igual para todas las alumnas de este nivel. Solo esto decide el resultado.</p>
            </div>
            <span className="eval-hint eval-hint-line">Decide el ascenso</span>
          </header>
          <EvaluationLiveFormV2
            evaluationId={evaluationId}
            blocks={blocks}
            hints={pole?.hints}
            onStatusChange={(itemId, status) =>
              setBaseStatus((current) => ({ ...current, [itemId]: status }))
            }
          />
        </section>

        {pole ? (
          <section className="eval-section eval-personal">
            <header className="eval-section-head">
              <div>
                <h2>Parte personalizada para {firstName}</h2>
                <p>
                  Se armó con su progreso de figuras. Valida figuras y alimenta su
                  retroalimentación; no cambia si sube de nivel.
                </p>
              </div>
              <form action={refreshEvaluationPersonalItemsAction}>
                <input type="hidden" name="evaluation_id" value={evaluationId} />
                <button className="eval-secondary-button" type="submit">
                  Volver a armar
                </button>
              </form>
            </header>

            {GROUPS.map((group) => (
              <div className="eval-personal-group" key={group.reason}>
                <h3>
                  <span className={`eval-dot eval-dot-${group.reason}`} aria-hidden="true" />
                  {group.reason === "next_level" && nextLevelTitle
                    ? `${group.title} · ${nextLevelTitle}`
                    : group.title}
                </h3>
                <p className="eval-muted">{group.why}</p>
                {groups[group.reason].length ? (
                  <div className="eval-v2-live-items">
                    {groups[group.reason].map((item) => (
                      <PersonalItemRow
                        key={item.id}
                        item={item}
                        status={personalStatus[item.id] ?? "not_evaluated"}
                        onChange={(id, status) =>
                          setPersonalStatus((current) => ({ ...current, [id]: status }))
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="eval-empty-inline">{group.empty}</div>
                )}
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <aside className="eval-workspace-side" aria-label="Resumen en vivo">
        <section className="eval-panel eval-live-summary">
          <span className="eval-eyebrow">En vivo</span>
          <div className="eval-summary-line">
            <span>Base del nivel</span>
            <strong>
              {baseDone} de {baseItems.length}
            </strong>
          </div>
          <div className="eval-meter" aria-hidden="true">
            <i
              style={{ width: `${baseItems.length ? (baseDone / baseItems.length) * 100 : 0}%` }}
            />
          </div>
          <p className="eval-muted">
            {baseMeets} cumplen. El resultado se calcula al finalizar la parte técnica · mínimo{" "}
            {passThreshold}%.
          </p>

          {pole ? (
            <>
              <div className="eval-summary-line">
                <span>Parte personalizada</span>
                <strong>
                  {personalDone} de {personalItems.length}
                </strong>
              </div>
              <div className="eval-changes">
                <span className="eval-eyebrow">Qué cambia en su portal al publicar</span>
                {changes &&
                (changes.confirmed.length || changes.added.length || changes.practice.length) ? (
                  <ul>
                    {changes.confirmed.length ? (
                      <li>
                        <span className="eval-dot eval-dot-mint" aria-hidden="true" />
                        Quedan validadas: {joinFigureNames(changes.confirmed)}
                      </li>
                    ) : null}
                    {changes.added.length ? (
                      <li>
                        <span className="eval-dot eval-dot-mint" aria-hidden="true" />
                        Nuevas en su progreso: {joinFigureNames(changes.added)}
                      </li>
                    ) : null}
                    {changes.practice.length ? (
                      <li>
                        <span className="eval-dot eval-dot-coral" aria-hidden="true" />
                        Para practicar: {joinFigureNames(changes.practice)}
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="eval-muted">Califica figuras para ver qué cambia en su portal.</p>
                )}
              </div>
            </>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
