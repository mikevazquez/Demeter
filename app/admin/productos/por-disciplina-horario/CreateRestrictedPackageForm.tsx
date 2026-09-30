"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createRestrictedPackage,
  type CreateRestrictedPackageState,
} from "./actions";

const initialState: CreateRestrictedPackageState = { error: null };

type ScopeKey = "disciplina" | "horario";
type PackageTerm = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

type Discipline = {
  id: string;
  name: string;
};

type ScheduleChoice = {
  id: string;
  weekday: number;
  localTime: string;
  activity: string;
  discipline: string;
};

type Props = {
  scope: ScopeKey;
  currency: string;
  locale: string;
  disciplines: Discipline[];
  schedules: ScheduleChoice[];
};

const packageTerms: Array<{
  key: PackageTerm;
  label: string;
  description: string;
  days: number | null;
}> = [
  { key: "monthly", label: "Mensual", description: "30 días", days: 30 },
  { key: "quarterly", label: "Trimestral", description: "90 días", days: 90 },
  { key: "semiannual", label: "Semestral", description: "180 días", days: 180 },
  { key: "annual", label: "Anual", description: "365 días", days: 365 },
  { key: "custom", label: "Otra", description: "Personalizada", days: null },
];

const weekdayLabels: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};

export function CreateRestrictedPackageForm({
  scope,
  currency,
  locale,
  disciplines,
  schedules,
}: Props) {
  const [state, formAction, pending] = useActionState(createRestrictedPackage, initialState);
  const [credits, setCredits] = useState(8);
  const [price, setPrice] = useState("600");
  const [packageTerm, setPackageTerm] = useState<PackageTerm>("monthly");
  const [customDays, setCustomDays] = useState(30);
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [selectedSchedules, setSelectedSchedules] = useState<string[]>([]);

  const validityDays =
    packageTerms.find((term) => term.key === packageTerm)?.days ?? customDays;

  const formattedPrice = useMemo(() => {
    const value = Number(price);
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  }, [currency, locale, price]);

  const selectedDisciplineNames = disciplines
    .filter((discipline) => selectedDisciplines.includes(discipline.id))
    .map((discipline) => discipline.name);

  const selectedScheduleLabels = schedules
    .filter((schedule) => selectedSchedules.includes(schedule.id))
    .map(
      (schedule) =>
        `${weekdayLabels[schedule.weekday] ?? ""} ${schedule.localTime.slice(0, 5)} · ${schedule.activity}`,
    );

  const toggleDiscipline = (id: string) => {
    setSelectedDisciplines((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const toggleSchedule = (id: string) => {
    setSelectedSchedules((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const groupedSchedules = Object.keys(weekdayLabels)
    .map(Number)
    .filter((weekday) => schedules.some((schedule) => schedule.weekday === weekday))
    .sort((left, right) => (left === 0 ? 7 : left) - (right === 0 ? 7 : right));

  return (
    <form action={formAction} className="package-form">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="package_term" value={packageTerm} />
      <input type="hidden" name="validity_days" value={validityDays} />

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ▤
          </span>
          <span>
            <strong>Datos básicos</strong>
            <span>Nombre, precio y clases incluidas.</span>
          </span>
        </div>

        <div className="package-form-grid">
          <label>
            Nombre del paquete
            <input
              name="name"
              required
              placeholder={
                scope === "disciplina"
                  ? "Ej. Pole Fitness · 8 clases"
                  : "Ej. Fin de semana · 8 clases"
              }
            />
          </label>

          <label>
            Precio {currency}
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
        </div>

        <div className="package-counter-row">
          <span className="package-counter-copy">
            <strong>Clases incluidas</strong>
            <span>Cantidad de usos disponibles.</span>
          </span>
          <span className="package-counter">
            <button
              type="button"
              aria-label="Quitar una clase"
              onClick={() => setCredits((value) => Math.max(1, value - 1))}
            >
              −
            </button>
            <input
              name="credit_limit"
              type="number"
              min="1"
              required
              value={credits}
              onChange={(event) => setCredits(Math.max(1, Number(event.target.value) || 1))}
              aria-label="Clases incluidas"
            />
            <button
              type="button"
              aria-label="Agregar una clase"
              onClick={() => setCredits((value) => value + 1)}
            >
              +
            </button>
          </span>
        </div>
      </section>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ◫
          </span>
          <span>
            <strong>Vigencia</strong>
            <span>Elige cuánto tiempo podrá usarse.</span>
          </span>
        </div>

        <div className="package-term-grid">
          {packageTerms.map((term) => (
            <button
              key={term.key}
              type="button"
              className={`package-term-option${packageTerm === term.key ? " is-selected" : ""}`}
              onClick={() => setPackageTerm(term.key)}
            >
              <strong>{term.label}</strong>
              <span>{term.description}</span>
            </button>
          ))}
        </div>

        {packageTerm === "custom" ? (
          <label>
            Días de vigencia
            <input
              type="number"
              min="1"
              value={customDays}
              onChange={(event) => setCustomDays(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        ) : null}
      </section>

      {scope === "disciplina" ? (
        <section className="package-form-card">
          <div className="package-form-card-heading">
            <span className="package-form-card-heading-icon" aria-hidden="true">
              ◇
            </span>
            <span>
              <strong>Disciplinas permitidas</strong>
              <span>Selecciona una o varias. No necesitas elegir horarios.</span>
            </span>
          </div>

          <div className="package-choice-grid">
            {disciplines.map((discipline) => {
              const selected = selectedDisciplines.includes(discipline.id);
              return (
                <label
                  key={discipline.id}
                  className={`package-choice-card${selected ? " is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    name="discipline_ids"
                    value={discipline.id}
                    checked={selected}
                    onChange={() => toggleDiscipline(discipline.id)}
                  />
                  <span>
                    <strong>{discipline.name}</strong>
                    <small>Todos sus horarios</small>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="package-scope-note">
            Si seleccionas todas las disciplinas, ese paquete pertenece a “Por clases”.
          </p>
        </section>
      ) : (
        <section className="package-form-card">
          <div className="package-form-card-heading">
            <span className="package-form-card-heading-icon" aria-hidden="true">
              ◷
            </span>
            <span>
              <strong>Horarios permitidos</strong>
              <span>Marca exactamente las clases donde este paquete podrá usarse.</span>
            </span>
          </div>

          <div className="package-schedule-groups">
            {groupedSchedules.map((weekday) => (
              <div className="package-schedule-day" key={weekday}>
                <strong>{weekdayLabels[weekday]}</strong>
                <div>
                  {schedules
                    .filter((schedule) => schedule.weekday === weekday)
                    .map((schedule) => {
                      const selected = selectedSchedules.includes(schedule.id);
                      return (
                        <label
                          key={schedule.id}
                          className={`package-schedule-option${selected ? " is-selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            name="schedule_ids"
                            value={schedule.id}
                            checked={selected}
                            onChange={() => toggleSchedule(schedule.id)}
                          />
                          <span>
                            <strong>
                              {schedule.localTime.slice(0, 5)} · {schedule.activity}
                            </strong>
                            <small>{schedule.discipline}</small>
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <details>
        <summary>
          <span>Opciones adicionales</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div>
          <label>
            Descripción opcional
            <textarea
              name="description"
              placeholder="Ej. Paquete especial para entrenar los fines de semana."
            />
          </label>
        </div>
      </details>

      <section className="package-form-card">
        <div className="package-form-card-heading">
          <span className="package-form-card-heading-icon" aria-hidden="true">
            ≡
          </span>
          <span>
            <strong>Resumen</strong>
            <span>Así quedará configurado.</span>
          </span>
        </div>

        <div className="package-summary">
          <strong>
            {credits} clases · {validityDays} días · {formattedPrice}
          </strong>
          <div className="package-chip-row">
            {(scope === "disciplina" ? selectedDisciplineNames : selectedScheduleLabels)
              .slice(0, 3)
              .map((label) => (
                <span className="package-list-chip" key={label}>
                  {label}
                </span>
              ))}
            {(scope === "disciplina" ? selectedDisciplineNames : selectedScheduleLabels).length >
            3 ? (
              <span className="package-list-chip is-muted">
                +
                {(scope === "disciplina" ? selectedDisciplineNames : selectedScheduleLabels)
                  .length - 3}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {state.error ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>{state.error}</p>
        </section>
      ) : null}

      <div className="package-form-actions">
        <button type="submit" className="packages-v2-primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar paquete"}
        </button>
        <a
          href={`/admin/productos/por-disciplina-horario/${scope}`}
          className="packages-v2-secondary"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
