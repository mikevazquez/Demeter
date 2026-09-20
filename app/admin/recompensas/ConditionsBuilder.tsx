"use client";

import { useMemo, useState } from "react";

export type ConditionInput = {
  key: string;
  metric: string;
  comparator: string;
  target: number;
};

const metricGroups = [
  {
    label: "Asistencia",
    options: [
      ["attendance.count", "Clases asistidas"],
      ["attendance.distinct_days", "Días distintos"],
      ["attendance.distinct_weeks", "Semanas distintas"],
      ["attendance.distinct_months", "Meses distintos"],
      ["attendance.distinct_disciplines", "Disciplinas distintas"],
      ["attendance.streak.days.current", "Racha actual de días"],
      ["attendance.streak.weeks.current", "Racha actual de semanas"],
      ["attendance.streak.months.current", "Racha actual de meses"],
      ["attendance.streak.days.best", "Mejor racha de días"],
      ["attendance.streak.weeks.best", "Mejor racha de semanas"],
      ["attendance.streak.months.best", "Mejor racha de meses"],
    ],
  },
  {
    label: "Fidelidad",
    options: [
      ["loyalty.current_consecutive_periods", "Periodos consecutivos actuales"],
      ["loyalty.total_paid_periods", "Periodos pagados acumulados"],
      ["loyalty.best_consecutive_periods", "Mejor racha de periodos"],
      ["loyalty.effective_days_since_coverage", "Días sin cobertura"],
    ],
  },
];

const comparators = [
  ["gte", "Al menos"],
  ["eq", "Exactamente"],
  ["lte", "Como máximo"],
];

export function ConditionsBuilder({
  initial,
}: {
  initial?: ConditionInput[];
}) {
  const [conditions, setConditions] = useState<ConditionInput[]>(
    initial?.length
      ? initial
      : [{ key: "condition_1", metric: "attendance.count", comparator: "gte", target: 1 }],
  );

  const payload = useMemo(
    () => JSON.stringify({ operator: "all", conditions }),
    [conditions],
  );

  function update(index: number, patch: Partial<ConditionInput>) {
    setConditions((current) =>
      current.map((condition, position) =>
        position === index ? { ...condition, ...patch } : condition,
      ),
    );
  }

  function add() {
    setConditions((current) => [
      ...current,
      {
        key: `condition_${current.length + 1}`,
        metric: current[0]?.metric.startsWith("loyalty.")
          ? "loyalty.total_paid_periods"
          : "attendance.count",
        comparator: "gte",
        target: 1,
      },
    ]);
  }

  function remove(index: number) {
    setConditions((current) => {
      if (current.length === 1) return current;
      return current
        .filter((_, position) => position !== index)
        .map((condition, position) => ({
          ...condition,
          key: `condition_${position + 1}`,
        }));
    });
  }

  return (
    <div className="grid gap-3">
      <input type="hidden" name="conditions_json" value={payload} />
      {conditions.map((condition, index) => (
        <div
          key={condition.key}
          className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-[1fr_150px_120px_auto]"
        >
          <label className="grid gap-1 text-sm text-zinc-300">
            Objetivo
            <select
              value={condition.metric}
              onChange={(event) => update(index, { metric: event.target.value })}
              className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
            >
              {metricGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-zinc-300">
            Condición
            <select
              value={condition.comparator}
              onChange={(event) => update(index, { comparator: event.target.value })}
              className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
            >
              {comparators.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-zinc-300">
            Meta
            <input
              type="number"
              min="0"
              step="1"
              value={condition.target}
              onChange={(event) =>
                update(index, { target: Number(event.target.value) })
              }
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>

          <button
            type="button"
            onClick={() => remove(index)}
            className="self-end rounded-xl border border-white/10 px-3 py-2.5 text-sm text-zinc-400 transition hover:border-rose-500/30 hover:text-rose-300"
          >
            Quitar
          </button>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={add}
          className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]"
        >
          + Agregar condición
        </button>
        <p className="mt-2 text-xs text-zinc-500">
          En V1 se deben cumplir todas las condiciones. No mezcles métricas de asistencia y
          fidelidad dentro de la misma configuración.
        </p>
      </div>
    </div>
  );
}
