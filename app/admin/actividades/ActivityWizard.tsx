"use client";

import { useMemo, useState } from "react";

import { saveActivity } from "./actions";

type Option = { id: string; label: string };

export type ActivityScheduleDraft = {
  id?: string;
  weekday: number;
  startTime: string;
};

export type ActivityDraft = {
  activityId?: string;
  name: string;
  description: string;
  durationMinutes: number;
  capacity: number;
  colorHex: string;
  requiresResource: boolean;
  defaultInstructorId: string;
  defaultSpaceId: string;
  startsOn: string;
  endsOn: string;
  schedules: ActivityScheduleDraft[];
  allowIndividualPurchase: boolean;
  individualPrice: string;
  individualPurchaseNotes: string;
};

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const STEPS = [
  { key: "general", label: "Información general" },
  { key: "schedule", label: "Horarios y operación" },
  { key: "sales", label: "Venta y acceso" },
  { key: "confirm", label: "Confirmación" },
] as const;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createSchedule(weekday: number): ActivityScheduleDraft {
  return {
    weekday,
    startTime: "18:00",
  };
}

export function ActivityWizard({
  instructors,
  spaces,
  initial,
  mode,
}: {
  instructors: Option[];
  spaces: Option[];
  initial?: ActivityDraft;
  mode: "create" | "edit";
}) {
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<ActivityDraft>(
    initial ?? {
      name: "",
      description: "",
      durationMinutes: 60,
      capacity: 5,
      colorHex: "#FF0A8A",
      requiresResource: false,
      defaultInstructorId: "",
      defaultSpaceId: "",
      startsOn: todayKey(),
      endsOn: "",
      schedules: [createSchedule(2)],
      allowIndividualPurchase: false,
      individualPrice: "",
      individualPurchaseNotes: "",
    },
  );

  const groupedSchedules = useMemo(() => {
    return DAYS.map((day, weekday) => ({
      day,
      weekday,
      rows: draft.schedules
        .map((row, index) => ({ row, index }))
        .filter((item) => item.row.weekday === weekday),
    })).filter((group) => group.rows.length);
  }, [draft.schedules]);

  function patch(next: Partial<ActivityDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setMessage("");
  }

  function patchSchedule(index: number, next: Partial<ActivityScheduleDraft>) {
    setDraft((current) => ({
      ...current,
      schedules: current.schedules.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...next } : row,
      ),
    }));
    setMessage("");
  }

  function removeSchedule(index: number) {
    if (draft.schedules.length === 1) {
      setMessage("La actividad necesita al menos un horario.");
      return;
    }
    setDraft((current) => ({
      ...current,
      schedules: current.schedules.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function addSchedule(weekday: number) {
    setDraft((current) => ({
      ...current,
      schedules: [...current.schedules, createSchedule(weekday)],
    }));
  }

  function addDay() {
    const used = new Set(draft.schedules.map((row) => row.weekday));
    const weekday = [1, 2, 3, 4, 5, 6, 0].find((day) => !used.has(day)) ?? 1;
    addSchedule(weekday);
  }

  function validateCurrentStep() {
    if (step === 0) {
      if (!draft.name.trim()) return "Escribe el nombre de la actividad.";
      if (draft.description.length > 500) return "La descripción admite máximo 500 caracteres.";
      if (
        !Number.isInteger(Number(draft.durationMinutes)) ||
        draft.durationMinutes < 15 ||
        draft.durationMinutes > 360
      ) {
        return "La duración debe estar entre 15 y 360 minutos.";
      }
      if (!Number.isInteger(Number(draft.capacity)) || draft.capacity < 1) {
        return "El cupo predeterminado debe ser de al menos 1 lugar.";
      }
      if (!/^#[0-9A-Fa-f]{6}$/.test(draft.colorHex)) {
        return "Selecciona un color válido para la actividad.";
      }
    }

    if (step === 1) {
      if (!draft.schedules.length) return "Agrega al menos un horario.";
      for (const row of draft.schedules) {
        if (!row.startTime) {
          return "Cada horario necesita una hora válida.";
        }
      }
      if (!draft.startsOn) return "Indica desde cuándo comienza la programación.";
      if (draft.endsOn && draft.endsOn < draft.startsOn) {
        return "La fecha final no puede ser anterior a la fecha de inicio.";
      }
      if (draft.requiresResource && !draft.defaultSpaceId) {
        return "Esta actividad requiere recurso: selecciona un espacio predeterminado.";
      }
    }

    if (step === 2) {
      if (draft.allowIndividualPurchase && !Number(draft.individualPrice)) {
        return "Indica el precio de compra individual.";
      }
      if (draft.individualPurchaseNotes.length > 300) {
        return "Las notas admiten máximo 300 caracteres.";
      }
    }

    return "";
  }

  function next() {
    const error = validateCurrentStep();
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("");
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function previous() {
    setMessage("");
    setStep((current) => Math.max(current - 1, 0));
  }

  return (
    <div className="activities-wizard">
      <nav className="activities-stepper" aria-label="Etapas de actividad">
        {STEPS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={index === step ? "is-active" : index < step ? "is-complete" : ""}
            onClick={() => {
              if (mode === "edit" || index <= step) {
                setMessage("");
                setStep(index);
              }
            }}
          >
            <span>{index < step ? "✓" : index + 1}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </nav>

      {message ? <div className="activities-inline-error">{message}</div> : null}

      {step === 0 ? (
        <section className="activities-stage">
          <div className="activities-stage-heading">
            <span>A01</span>
            <div>
              <h2>Información general</h2>
              <p>
                Define lo esencial de la actividad. Las reglas de cada sesión se ajustan después.
              </p>
            </div>
          </div>

          <div className="activities-form-grid">
            <label className="activities-field activities-field-wide">
              <span>Nombre de la actividad *</span>
              <input
                value={draft.name}
                maxLength={80}
                placeholder="Ej. Pole Fitness"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>

            <label className="activities-field activities-field-wide">
              <span>Descripción</span>
              <textarea
                rows={5}
                maxLength={500}
                value={draft.description}
                placeholder="Describe brevemente qué trabajarán las alumnas."
                onChange={(event) => patch({ description: event.target.value })}
              />
              <small>{draft.description.length}/500</small>
            </label>

            <label className="activities-field">
              <span>Duración predeterminada *</span>
              <div className="activities-unit-field">
                <input
                  type="number"
                  min={15}
                  max={360}
                  value={draft.durationMinutes}
                  onChange={(event) => patch({ durationMinutes: Number(event.target.value) })}
                />
                <b>minutos</b>
              </div>
            </label>

            <label className="activities-field">
              <span>Cupo predeterminado *</span>
              <div className="activities-unit-field">
                <input
                  type="number"
                  min={1}
                  value={draft.capacity}
                  onChange={(event) => patch({ capacity: Number(event.target.value) })}
                />
                <b>lugares</b>
              </div>
            </label>

            <label className="activities-field activities-color-field">
              <span>Color en el horario *</span>
              <div className="activities-color-control">
                <input
                  type="color"
                  value={draft.colorHex}
                  onChange={(event) => patch({ colorHex: event.target.value.toUpperCase() })}
                  aria-label="Color de la actividad"
                />
                <b>{draft.colorHex.toUpperCase()}</b>
              </div>
              <small>Se usa para identificar esta actividad en Agenda y en reservas.</small>
            </label>

            <fieldset className="activities-choice activities-field-wide">
              <legend>¿Requiere recurso? *</legend>
              <div>
                <button
                  type="button"
                  className={draft.requiresResource ? "is-selected" : ""}
                  onClick={() => patch({ requiresResource: true })}
                >
                  Sí
                </button>
                <button
                  type="button"
                  className={!draft.requiresResource ? "is-selected" : ""}
                  onClick={() => patch({ requiresResource: false })}
                >
                  No
                </button>
              </div>
              <small>
                {draft.requiresResource
                  ? "Esta actividad utiliza recursos del estudio."
                  : "La reserva no pedirá seleccionar un recurso físico."}
              </small>
            </fieldset>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="activities-stage">
          <div className="activities-stage-heading">
            <span>A02</span>
            <div>
              <h2>Horarios y operación</h2>
              <p>Define únicamente los días y horas. El resto se hereda en cada sesión.</p>
            </div>
          </div>

          <div className="activities-operation-defaults">
            <div className="activities-operation-copy">
              <span>OPERACIÓN PREDETERMINADA</span>
              <strong>Datos que heredarán las sesiones</strong>
              <p>
                Si un coach, espacio o fecha cambia solo para una sesión, se edita después desde
                Agenda sin alterar la actividad.
              </p>
            </div>

            <div className="activities-operation-grid">
              <label className="activities-field">
                <span>Coach predeterminado</span>
                <select
                  value={draft.defaultInstructorId}
                  onChange={(event) => patch({ defaultInstructorId: event.target.value })}
                >
                  <option value="">Sin coach asignado</option>
                  {instructors.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="activities-field">
                <span>Espacio{draft.requiresResource ? " *" : ""}</span>
                <select
                  value={draft.defaultSpaceId}
                  onChange={(event) => patch({ defaultSpaceId: event.target.value })}
                >
                  <option value="">Sin espacio asignado</option>
                  {spaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="activities-field">
                <span>Comienza *</span>
                <input
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) => patch({ startsOn: event.target.value })}
                />
              </label>

              <label className="activities-field">
                <span>Termina</span>
                <input
                  type="date"
                  value={draft.endsOn}
                  onChange={(event) => patch({ endsOn: event.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="activities-day-list">
            {groupedSchedules.map((group) => (
              <article className="activities-day-card" key={group.weekday}>
                <header>
                  <div>
                    <small>DÍA</small>
                    <strong>{group.day}</strong>
                  </div>
                  <button type="button" onClick={() => addSchedule(group.weekday)}>
                    + Agregar hora
                  </button>
                </header>

                <div className="activities-slot-list">
                  {group.rows.map(({ row, index }) => (
                    <div
                      className="activities-slot activities-slot-compact"
                      key={row.id ?? `${group.weekday}-${index}`}
                    >
                      <label className="activities-field">
                        <span>Hora</span>
                        <input
                          type="time"
                          value={row.startTime}
                          onChange={(event) =>
                            patchSchedule(index, { startTime: event.target.value })
                          }
                        />
                      </label>

                      <span className="activities-duration-chip">{draft.durationMinutes} min</span>

                      <button
                        type="button"
                        className="activities-remove-slot"
                        onClick={() => removeSchedule(index)}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <button type="button" className="activities-add-day" onClick={addDay}>
            + Agregar día
          </button>

          <p className="activities-helper">
            La duración se toma de Información general. Cada horario genera sesiones con el coach,
            espacio y vigencia predeterminados de arriba.
          </p>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="activities-stage">
          <div className="activities-stage-heading">
            <span>A03</span>
            <div>
              <h2>Venta y acceso</h2>
              <p>Define cómo puede acceder una alumna a esta actividad.</p>
            </div>
          </div>

          <div className="activities-credit-card">
            <span>CRÉDITOS</span>
            <strong>Todas las actividades utilizan créditos</strong>
            <p>La reserva consume un crédito compatible del paquete activo de la alumna.</p>
          </div>

          <div className="activities-sales-card">
            <label className="activities-toggle-row">
              <span>
                <strong>Permitir compra individual</strong>
                <small>
                  Si no tiene un crédito compatible, podrá comprar únicamente esa sesión.
                </small>
              </span>
              <input
                type="checkbox"
                checked={draft.allowIndividualPurchase}
                onChange={(event) => patch({ allowIndividualPurchase: event.target.checked })}
              />
            </label>

            {draft.allowIndividualPurchase ? (
              <label className="activities-field">
                <span>Precio de compra individual *</span>
                <div className="activities-price-field">
                  <b>$</b>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.individualPrice}
                    placeholder="150"
                    onChange={(event) => patch({ individualPrice: event.target.value })}
                  />
                  <em>MXN</em>
                </div>
                <small>
                  Este precio aplica a todas las sesiones compradas individualmente desde el portal
                  o desde el estudio.
                </small>
              </label>
            ) : null}

            <label className="activities-field">
              <span>Notas adicionales (opcional)</span>
              <textarea
                rows={4}
                maxLength={300}
                value={draft.individualPurchaseNotes}
                onChange={(event) => patch({ individualPurchaseNotes: event.target.value })}
                placeholder="Indicaciones adicionales para la compra individual."
              />
              <small>{draft.individualPurchaseNotes.length}/300</small>
            </label>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="activities-stage">
          <div className="activities-stage-heading">
            <span>A04</span>
            <div>
              <h2>Confirmación</h2>
              <p>
                Revisa la actividad antes de {mode === "create" ? "crearla" : "guardar cambios"}.
              </p>
            </div>
          </div>

          <div className="activities-review-list">
            <article className="activities-review-card">
              <header>
                <strong>Información general</strong>
                <button type="button" onClick={() => setStep(0)}>
                  Editar
                </button>
              </header>
              <dl>
                <div>
                  <dt>Actividad</dt>
                  <dd>{draft.name || "—"}</dd>
                </div>
                <div>
                  <dt>Duración</dt>
                  <dd>{draft.durationMinutes} minutos</dd>
                </div>
                <div>
                  <dt>Cupo</dt>
                  <dd>{draft.capacity} lugares</dd>
                </div>
                <div>
                  <dt>Color</dt>
                  <dd className="activities-review-color">
                    <i style={{ background: draft.colorHex }} />
                    {draft.colorHex.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>Requiere recurso</dt>
                  <dd>{draft.requiresResource ? "Sí" : "No"}</dd>
                </div>
              </dl>
            </article>

            <article className="activities-review-card">
              <header>
                <strong>Horarios y operación</strong>
                <button type="button" onClick={() => setStep(1)}>
                  Editar
                </button>
              </header>
              <div className="activities-review-schedules">
                {draft.schedules.map((row, index) => (
                  <span key={row.id ?? index}>
                    <b>{DAYS[row.weekday]}</b> {row.startTime} · {draft.durationMinutes} min
                  </span>
                ))}
                <span>
                  <b>Hereda</b>{" "}
                  {draft.defaultInstructorId
                    ? instructors.find((item) => item.id === draft.defaultInstructorId)?.label ?? "Coach"
                    : "Sin coach"}{" "}
                  ·{" "}
                  {draft.defaultSpaceId
                    ? spaces.find((item) => item.id === draft.defaultSpaceId)?.label ?? "Espacio"
                    : "Sin espacio"}{" "}
                  · desde {draft.startsOn}
                  {draft.endsOn ? ` hasta ${draft.endsOn}` : ""}
                </span>
              </div>
            </article>

            <article className="activities-review-card">
              <header>
                <strong>Venta y acceso</strong>
                <button type="button" onClick={() => setStep(2)}>
                  Editar
                </button>
              </header>
              <dl>
                <div>
                  <dt>Requiere créditos</dt>
                  <dd>Sí · todos los paquetes compatibles</dd>
                </div>
                <div>
                  <dt>Compra individual</dt>
                  <dd>{draft.allowIndividualPurchase ? "Sí" : "No"}</dd>
                </div>
                {draft.allowIndividualPurchase ? (
                  <div>
                    <dt>Precio individual</dt>
                    <dd>${Number(draft.individualPrice || 0).toLocaleString("es-MX")} MXN</dd>
                  </div>
                ) : null}
              </dl>
            </article>
          </div>

          <div className="activities-ready-card">
            <span>✓</span>
            <p>
              {mode === "create"
                ? "Se creará como activa y comenzará a generar sesiones según los horarios configurados."
                : "Los cambios quedarán guardados. Las sesiones con reservas se conservan como excepciones si modificas un horario."}
            </p>
          </div>
        </section>
      ) : null}

      <footer className="activities-wizard-footer">
        <button
          type="button"
          className="activities-back-button"
          onClick={previous}
          disabled={step === 0}
        >
          Atrás
        </button>

        {step < STEPS.length - 1 ? (
          <button type="button" className="activities-next-button" onClick={next}>
            Continuar
          </button>
        ) : (
          <form action={saveActivity}>
            <input type="hidden" name="payload" value={JSON.stringify(draft)} />
            <button type="submit" className="activities-next-button">
              {mode === "create" ? "Crear actividad" : "Guardar cambios"}
            </button>
          </form>
        )}
      </footer>
    </div>
  );
}
