"use client";

// POLE-01-16 · Live grade while the coach evaluates a catalog (Pole) evaluation.

import { useMemo, useState } from "react";

import { poleLiveScore, type LiveBlock } from "@/lib/pole/live-score";

import { EvaluationLiveFormV2, type EvaluationV2BlockLive } from "./EvaluationLiveFormV2";

const BLOCK_LABEL: Record<string, string> = {
  pole_combo: "Combo",
  pole_mandatory: "Obligatorias",
  pole_nomenclature: "Nomenclatura",
};

const OUTLOOK_COPY = {
  incomplete: "Faltan calificaciones",
  stays: "Por debajo del mínimo",
  retained: "Alcanza el mínimo · sube cuando logre las obligatorias que faltan",
  approved: "Alcanza el mínimo · sube de nivel",
} as const;

type ItemState = { status: string; score: number | null };

export function PoleLiveWorkspace({
  evaluationId,
  blocks,
  blockKeys,
  minimum,
}: {
  evaluationId: string;
  blocks: EvaluationV2BlockLive[];
  blockKeys: Record<string, string>;
  minimum: number;
}) {
  const [overrides, setOverrides] = useState<Record<string, ItemState>>({});

  const live = useMemo(() => {
    const liveBlocks: LiveBlock[] = blocks.map((block) => ({
      key: blockKeys[block.id] ?? block.id,
      weightPercent: block.weightPercent,
      items: block.items.map((item) => {
        const current = overrides[item.id];
        return {
          id: item.id,
          name: item.name,
          scored: item.scored,
          maxScore: item.maxScore,
          weightPercent: item.weightPercent,
          status: current?.status ?? item.resultStatus,
          score: current ? current.score : item.score,
        };
      }),
    }));
    return poleLiveScore(liveBlocks, minimum);
  }, [blocks, blockKeys, minimum, overrides]);

  return (
    <>
      <section
        className={`eval-panel pole-live pole-live-${live.outlook}`}
        aria-live="polite"
        aria-labelledby="pole-live-title"
      >
        <div className="pole-live-head">
          <h2 id="pole-live-title">Calificación en vivo</h2>
          <p className="pole-live-total">
            <strong>{live.total.toFixed(1)}</strong>
            <span> / mínimo {minimum}</span>
          </p>
        </div>
        <div className="pole-live-track" aria-hidden="true">
          <i style={{ width: `${Math.min(live.total, 100)}%` }} />
          <b style={{ left: `${Math.min(minimum, 100)}%` }} />
        </div>
        <ul className="pole-live-blocks">
          {Object.entries(live.blocks).map(([key, block]) => (
            <li key={key}>
              <span>{BLOCK_LABEL[key] ?? key}</span>
              <strong>{Math.round(block.percent)} %</strong>
              <small>
                {block.done}/{block.total}
              </small>
            </li>
          ))}
        </ul>
        <p className="pole-live-outlook">{OUTLOOK_COPY[live.outlook]}</p>
        {live.missingMandatory.length ? (
          <p className="pole-live-warning" role="status">
            Falta {live.missingMandatory.length === 1 ? "la obligatoria" : "las obligatorias"}:{" "}
            {live.missingMandatory.join(", ")}
          </p>
        ) : null}
      </section>

      <EvaluationLiveFormV2
        evaluationId={evaluationId}
        blocks={blocks}
        onItemSaved={(itemId, status, score) =>
          setOverrides((previous) => ({ ...previous, [itemId]: { status, score } }))
        }
      />
    </>
  );
}
