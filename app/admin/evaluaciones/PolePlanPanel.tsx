import type { PoleEvaluationContext, PolePlanFigure } from "@/lib/pole/evaluation-plan";
import { POLE_STUDENT_LEVEL_LABEL } from "@/lib/pole/level-settings";

import {
  confirmPoleFigureAction,
  proposePolePlanAction,
  savePolePlanAction,
  startPolePlanAction,
} from "./pole-plan-actions";

const POLE_MESSAGES: Record<string, string> = {
  saved: "Figuras guardadas.",
  pole_plan_invalid:
    "Usa 7 figuras distintas del nivel de la alumna y que no sean obligatorias del nivel.",
  pole_plan_locked: "La evaluación ya empezó: las figuras quedaron fijas.",
  pole_plan_confirmation_required: "En Élite confirma cada figura en vivo antes de empezar.",
  pole_plan_not_enough_figures: "El catálogo no tiene suficientes figuras para este nivel.",
  forbidden: "Tu rol no puede preparar evaluaciones.",
  pole_plan_failed: "No se pudo guardar. Intenta de nuevo.",
};

function FigureSelect({
  name,
  value,
  candidates,
  label,
}: {
  name: string;
  value: PolePlanFigure;
  candidates: PolePlanFigure[];
  label: string;
}) {
  const options = candidates.some((candidate) => candidate.id === value.id)
    ? candidates
    : [value, ...candidates];
  return (
    <label className="pole-plan-field">
      <span>{label}</span>
      <select name={name} defaultValue={value.id} required>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PolePlanPanel({
  evaluationId,
  context,
  canWrite,
  message,
}: {
  evaluationId: string;
  context: PoleEvaluationContext;
  canWrite: boolean;
  message?: string;
}) {
  const plan = context.plan;
  const level = context.levelKey ? POLE_STUDENT_LEVEL_LABEL[context.levelKey] : "";
  const isElite = context.levelKey === "elite";
  const notice = message ? POLE_MESSAGES[message] : null;

  if (!plan) {
    return (
      <section className="eval-panel pole-plan" aria-labelledby="pole-plan-title">
        <h2 id="pole-plan-title">Figuras de la evaluación · {level}</h2>
        <p className="pole-plan-copy">
          El sistema propone un combo de 4 figuras y un dictado de 3 figuras distintas del nivel de
          la alumna. Puedes cambiarlas antes de empezar.
        </p>
        {notice ? <p className="pole-plan-notice">{notice}</p> : null}
        {canWrite ? (
          <form action={proposePolePlanAction}>
            <input type="hidden" name="evaluation_id" value={evaluationId} />
            <button className="eval-primary-button" type="submit">
              Proponer figuras
            </button>
          </form>
        ) : null}
      </section>
    );
  }

  if (plan.locked) {
    return (
      <section className="eval-panel pole-plan" aria-labelledby="pole-plan-title">
        <h2 id="pole-plan-title">Figuras de la evaluación · {level}</h2>
        <dl className="pole-plan-summary">
          <div>
            <dt>Combo de evaluación</dt>
            <dd>{plan.combo.map((figure) => figure.name).join(" → ")}</dd>
          </div>
          <div>
            <dt>Combo dictado</dt>
            <dd>{plan.dictated.map((figure) => figure.name).join(" · ")}</dd>
          </div>
        </dl>
      </section>
    );
  }

  const all = [...plan.combo, ...plan.dictated];
  const pendingConfirmation = isElite
    ? all.filter((figure) => !plan.confirmed.includes(figure.id))
    : [];

  return (
    <section className="eval-panel pole-plan" aria-labelledby="pole-plan-title">
      <h2 id="pole-plan-title">Prepara la evaluación · {level}</h2>
      <p className="pole-plan-copy">
        Revisa las figuras. Puedes cambiar cualquiera antes de empezar; al empezar quedan fijas.
        {isElite
          ? " En Élite confirma cada figura Profesional con la alumna antes de empezar."
          : ""}
      </p>
      {notice ? <p className="pole-plan-notice">{notice}</p> : null}

      <form className="pole-plan-form" action={savePolePlanAction}>
        <input type="hidden" name="evaluation_id" value={evaluationId} />
        <fieldset disabled={!canWrite}>
          <legend>Combo de evaluación · 4 figuras</legend>
          {plan.combo.map((figure, index) => (
            <FigureSelect
              key={`combo-${index}`}
              name={`combo_${index}`}
              value={figure}
              candidates={plan.candidates}
              label={`Figura ${index + 1}`}
            />
          ))}
        </fieldset>
        <fieldset disabled={!canWrite}>
          <legend>Combo dictado · 3 figuras distintas</legend>
          {plan.dictated.map((figure, index) => (
            <FigureSelect
              key={`dictated-${index}`}
              name={`dictated_${index}`}
              value={figure}
              candidates={plan.candidates}
              label={`Dictada ${index + 1}`}
            />
          ))}
        </fieldset>
        {canWrite ? (
          <button className="eval-secondary-button" type="submit">
            Guardar cambios
          </button>
        ) : null}
      </form>

      {isElite ? (
        <ul className="pole-plan-confirm">
          {all.map((figure) => {
            const confirmed = plan.confirmed.includes(figure.id);
            return (
              <li key={figure.id}>
                <span>{figure.name}</span>
                {canWrite ? (
                  <form action={confirmPoleFigureAction}>
                    <input type="hidden" name="evaluation_id" value={evaluationId} />
                    <input type="hidden" name="figure_id" value={figure.id} />
                    <input type="hidden" name="confirmed" value={confirmed ? "false" : "true"} />
                    <button
                      className={confirmed ? "eval-secondary-button" : "eval-primary-button"}
                      type="submit"
                    >
                      {confirmed ? "Confirmada · deshacer" : "Confirmar"}
                    </button>
                  </form>
                ) : (
                  <span>{confirmed ? "Confirmada" : "Pendiente"}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canWrite ? (
        <div className="pole-plan-actions">
          <form action={proposePolePlanAction}>
            <input type="hidden" name="evaluation_id" value={evaluationId} />
            <button className="eval-secondary-button" type="submit">
              Proponer otras
            </button>
          </form>
          <form action={startPolePlanAction}>
            <input type="hidden" name="evaluation_id" value={evaluationId} />
            <button
              className="eval-primary-button"
              type="submit"
              disabled={pendingConfirmation.length > 0}
            >
              Empezar evaluación
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
