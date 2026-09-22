"use client";

import { useState, useTransition } from "react";

import { deleteEvaluationV2ItemAction, saveEvaluationV2ItemInlineAction } from "../../v2-actions";

export function EvaluationAspectRow({
  templateId,
  versionId,
  blockId,
  itemId,
  name,
  weightPercent,
  minScore,
  progressionRequired,
  weighted,
  editable,
}: {
  templateId: string;
  versionId: string;
  blockId: string;
  itemId: string;
  name: string;
  weightPercent: number | string | null;
  minScore: number | string | null;
  progressionRequired: boolean;
  weighted: boolean;
  editable: boolean;
}) {
  const [label, setLabel] = useState(name);
  const [weight, setWeight] = useState(weightPercent === null ? "" : String(weightPercent));
  const [required, setRequired] = useState(progressionRequired);
  const [minimum, setMinimum] = useState(minScore === null ? "" : String(minScore));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(overrides?: { required?: boolean; minimum?: string }) {
    if (!editable) return;

    const nextRequired = overrides?.required ?? required;
    const nextMinimum = overrides?.minimum ?? minimum;
    const formData = new FormData();
    formData.set("template_id", templateId);
    formData.set("version_id", versionId);
    formData.set("block_id", blockId);
    formData.set("item_id", itemId);
    formData.set("label", label);
    formData.set("item_weight_percent", weighted ? weight : "");
    formData.set("min_score", weighted && nextRequired ? nextMinimum : "");
    if (nextRequired) formData.set("progression_required", "on");

    startTransition(async () => {
      const result = await saveEvaluationV2ItemInlineAction(formData);
      setMessage(result.ok ? "Guardado" : result.message);
    });
  }

  return (
    <div className={`eval-simple-item-card ${weighted ? "is-weighted" : "is-simple"}`}>
      <div className={`eval-simple-item-row ${weighted ? "is-weighted" : "is-simple"}`}>
        <span className="eval-simple-drag" aria-hidden="true">
          ⠿
        </span>

        <input
          aria-label={`Nombre de ${name}`}
          className="eval-simple-item-name"
          disabled={!editable}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
          onBlur={() => save()}
        />

        {weighted ? (
          <div className="eval-simple-item-percent">
            <input
              aria-label={`Peso de ${name}`}
              disabled={!editable}
              max={100}
              min={0}
              step="0.01"
              type="number"
              value={weight}
              onChange={(event) => setWeight(event.currentTarget.value)}
              onBlur={() => save()}
            />
            <span>%</span>
          </div>
        ) : null}

        {editable ? (
          <form action={deleteEvaluationV2ItemAction}>
            <input type="hidden" name="template_id" value={templateId} />
            <input type="hidden" name="version_id" value={versionId} />
            <input type="hidden" name="block_id" value={blockId} />
            <input type="hidden" name="item_id" value={itemId} />
            <button className="eval-simple-row-delete" type="submit" aria-label={`Eliminar ${name}`}>
              ⌫
            </button>
          </form>
        ) : null}
      </div>

      <div className="eval-simple-item-rule">
        <label className="eval-simple-check">
          <input
            type="checkbox"
            checked={required}
            disabled={!editable}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setRequired(checked);
              save({ required: checked });
            }}
          />
          <span>Requisito para avanzar</span>
        </label>

        {weighted && required ? (
          <label className="eval-simple-inline-minimum">
            <span>Mínimo requerido</span>
            <div>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={minimum}
                disabled={!editable}
                placeholder="Ej. 70"
                onChange={(event) => setMinimum(event.currentTarget.value)}
                onBlur={() => save({ minimum })}
              />
              <span>%</span>
            </div>
          </label>
        ) : required ? (
          <small>Debe marcarse como cumplido para permitir el avance.</small>
        ) : null}

        <small className="eval-simple-inline-save">{isPending ? "Guardando…" : message}</small>
      </div>
    </div>
  );
}
