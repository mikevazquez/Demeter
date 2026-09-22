"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveActivity } from "./actions";

type Option = { id: string; label: string };
type ResourceOption = { id: string; spaceId: string; label: string; typeLabel?: string };

export type ActivityResourceSettingDraft = {
  resourceId: string;
  enabled: boolean;
  capacityOverride: number | null;
};

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
  resourceUsesPerItem: number;
  resourceSettings: ActivityResourceSettingDraft[];
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

function SaveActivityButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="activities-next-button" disabled={pending}>
      {pending ? "Guardando…" : mode === "create" ? "Crear actividad" : "Guardar cambios"}
    </button>
  );
}

const STEPS = [
  { key: "general", label: "Información general" },
  { key: "schedule", label: "Horarios y operación" },
  { key: "sales", label: "Venta y acceso" },
  { key: "resources", label: "Recursos" },
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
  resources,
  initial,
  mode,
  saveError = false,
}: {
  instructors: Option[];
  spaces: Option[];
  resources: ResourceOption[];
  initial?: ActivityDraft;
  mode: "create" | "edit";
  saveError?: boolean;
}) {
  const [step, setStep] = useState(saveError ? 4 : 0);
  const [message, setMessage] = useState("");
  const [serverSaveError, setServerSaveError] = useState(saveError);
  const [draft, setDraft] = useState<ActivityDraft>(
    initial ?? {
      name: "",
      description: "",
      durationMinutes: 60,
      capacity: 5,
      colorHex: "#FF0A8A",
      requiresResource: false,
      resourceUsesPerItem: 1,
      resourceSettings: [],
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

  const visibleResources = useMemo(
    () => resources.filter((resource) => resource.spaceId === draft.defaultSpaceId),
    [resources, draft.defaultSpaceId],
  );

  const resourceSettingMap = useMemo(
    () => new Map(draft.resourceSettings.map((setting) => [setting.resourceId, setting])),
    [draft.resourceSettings],
  );

  function patch(next: Partial<ActivityDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setMessage("");
    setServerSaveError(false);
  }

  function selectDefaultSpace(spaceId: string) {
    setDraft((current) => {
      const previousSettings = new Map(
        current.resourceSettings.map((setting) => [setting.resourceId, setting]),
      );
      const nextSettings = resources
        .filter((resource) => resource.spaceId === spaceId)
        .map(
          (resource) =>
            previousSettings.get(resource.id) ?? {
              resourceId: resource.id,
              enabled: true,
              capacityOverride: null,
            },
        );

      return {
        ...current,
        defaultSpaceId: spaceId,
        resourceSettings: nextSettings,
      };
    });
    setMessage("");
    setServerSaveError(false);
  }

  function patchResourceSetting(resourceId: string, next: Partial<ActivityResourceSettingDraft>) {
    setDraft((current) => {
      const existing = current.resourceSettings.find(
        (setting) => setting.resourceId === resourceId,
      ) ?? {
        resourceId,
        enabled: true,
        capacityOverride: null,
      };

      const hasExisting = current.resourceSettings.some(
        (setting) => setting.resourceId === resourceId,
      );

      return {
        ...current,
        resourceSettings: hasExisting
          ? current.resourceSettings.map((setting) =>
              setting.resourceId === resourceId ? { ...setting, ...next } : setting,
            )
          : [...current.resourceSettings, { ...existing, ...next }],
      };
    });
    setMessage("");
    setServerSaveError(false);
  }

  function patchSchedule(index: number, next: Partial<ActivityScheduleDraft>) {
    setDraft((current) => ({
      ...current,
      schedules: current.schedules.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...next } : row,
      ),
    }));
    setMessage("");
    setServerSaveError(false);
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

    if (step === 3 && draft.requiresResource) {
      if (!draft.defaultSpaceId) {
        return "Selecciona el espacio donde estarán los recursos.";
      }
      if (
        !Number.isInteger(Number(draft.resourceUsesPerItem)) ||
        draft.resourceUsesPerItem < 1 ||
        draft.resourceUsesPerItem > 20
      ) {
        return "Personas por recurso debe estar entre 1 y 20.";
      }
      if (!visibleResources.length) {
        return "Este espacio todavía no tiene recursos activos configurados.";
      }
      const activeSettings = visibleResources.filter((resource) => {
        const setting = resourceSettingMap.get(resource.id);
        return setting?.enabled ?? true;
      });
      if (!activeSettings.length) {
        return "Activa al menos un recurso para esta actividad.";
      }
      const invalidCapacity = visibleResources.some((resource) => {
        const capacity = resourceSettingMap.get(resource.id)?.capacityOverride;
        return (
          capacity != null &&
          (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || Number(capacity) > 20)
        );
      });
      if (invalidCapacity) {
        return "La capacidad personalizada de cada recurso debe estar entre 1 y 20.";
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
    setServerSaveError(false);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function previous() {
    setMessage("");
    setServerSaveError(false);
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
                setServerSaveError(false);
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
                  onChange={(event) => selectDefaultSpace(event.target.value)}
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
              <h2>Recursos</h2>
              <p>
                Define la configuración base que heredarán las nuevas sesiones. Una sesión puede
                personalizarse después sin cambiar la actividad.
              </p>
            </div>
          </div>

          {!draft.requiresResource ? (
            <div className="activities-credit-card">
              <span>RECURSOS</span>
              <strong>Esta actividad no requiere recursos físicos</strong>
              <p>
                Si cambias “¿Requiere recurso?” a Sí en Información general, aquí podrás definir la
                capacidad de cada recurso.
              </p>
            </div>
          ) : (
            <>
              <div className="activities-operation-defaults">
                <div className="activities-operation-copy">
                  <span>CONFIGURACIÓN PREDETERMINADA</span>
                  <strong>Recursos que heredarán las sesiones</strong>
                  <p>
                    El valor general se aplica a todos. Puedes hacer excepciones por recurso y
                    después personalizar una sesión concreta desde Agenda.
                  </p>
                </div>

                <div className="activities-operation-grid">
                  <label className="activities-field">
                    <span>Espacio predeterminado *</span>
                    <select
                      value={draft.defaultSpaceId}
                      onChange={(event) => selectDefaultSpace(event.target.value)}
                    >
                      <option value="">Selecciona un espacio</option>
                      {spaces.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="activities-field">
                    <span>Personas por recurso *</span>
                    <div className="activities-unit-field">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={draft.resourceUsesPerItem}
                        onChange={(event) =>
                          patch({ resourceUsesPerItem: Number(event.target.value) })
                        }
                      />
                      <b>personas</b>
                    </div>
                    <small>
                      Este valor se aplicará por defecto a cada recurso de las nuevas sesiones.
                    </small>
                  </label>
                </div>
              </div>

              <div className="activities-resource-defaults">
                <div className="activities-resource-defaults-header">
                  <div>
                    <strong>Recursos disponibles en el espacio</strong>
                    <p>Activa los que usa esta actividad y define excepciones de capacidad.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        resourceSettings: visibleResources.map((resource) => ({
                          resourceId: resource.id,
                          enabled: true,
                          capacityOverride: null,
                        })),
                      }))
                    }
                  >
                    Aplicar a todos
                  </button>
                </div>

                {visibleResources.length ? (
                  <div className="activities-resource-defaults-list">
                    {visibleResources.map((resource) => {
                      const setting = resourceSettingMap.get(resource.id) ?? {
                        resourceId: resource.id,
                        enabled: true,
                        capacityOverride: null,
                      };
                      const effectiveCapacity =
                        setting.capacityOverride ?? draft.resourceUsesPerItem;

                      return (
                        <article className="activities-resource-default-row" key={resource.id}>
                          <label className="activities-resource-toggle">
                            <input
                              type="checkbox"
                              checked={setting.enabled}
                              onChange={(event) =>
                                patchResourceSetting(resource.id, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            <span>
                              <strong>{resource.label}</strong>
                              <small>{resource.typeLabel ?? "Recurso"}</small>
                            </span>
                          </label>

                          <label className="activities-field">
                            <span>Personas por recurso</span>
                            <select
                              value={effectiveCapacity}
                              disabled={!setting.enabled}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                patchResourceSetting(resource.id, {
                                  capacityOverride:
                                    value === draft.resourceUsesPerItem ? null : value,
                                });
                              }}
                            >
                              {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                            <small>
                              {setting.capacityOverride == null
                                ? "Hereda el valor general"
                                : "Excepción para este recurso"}
                            </small>
                          </label>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="activities-inline-error">
                    Este espacio todavía no tiene recursos activos configurados.
                  </div>
                )}
              </div>

              <p className="activities-helper">
                Las sesiones nuevas heredarán esta configuración. Si personalizas una sesión desde
                Agenda, esa sesión conservará su propia configuración.
              </p>
            </>
          )}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="activities-stage">
          <div className="activities-stage-heading">
            <span>A05</span>
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
                    ? (instructors.find((item) => item.id === draft.defaultInstructorId)?.label ??
                      "Coach")
                    : "Sin coach"}{" "}
                  ·{" "}
                  {draft.defaultSpaceId
                    ? (spaces.find((item) => item.id === draft.defaultSpaceId)?.label ?? "Espacio")
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

            <article className="activities-review-card">
              <header>
                <strong>Recursos</strong>
                <button type="button" onClick={() => setStep(3)}>
                  Editar
                </button>
              </header>
              <dl>
                <div>
                  <dt>Requiere recursos</dt>
                  <dd>{draft.requiresResource ? "Sí" : "No"}</dd>
                </div>
                {draft.requiresResource ? (
                  <>
                    <div>
                      <dt>Personas por recurso</dt>
                      <dd>{draft.resourceUsesPerItem}</dd>
                    </div>
                    <div>
                      <dt>Recursos activos</dt>
                      <dd>
                        {
                          visibleResources.filter(
                            (resource) => resourceSettingMap.get(resource.id)?.enabled ?? true,
                          ).length
                        }
                      </dd>
                    </div>
                  </>
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
        {serverSaveError && step === 4 ? (
          <p className="activities-save-error">
            No se guardó. Revisa los datos e inténtalo de nuevo.
          </p>
        ) : null}
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
            <SaveActivityButton mode={mode} />
          </form>
        )}
      </footer>
    </div>
  );
}
