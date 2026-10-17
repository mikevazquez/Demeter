"use client";
import { useActionState, useState } from "react";
import { createProgram } from "../actions";
import { followingWeek, type ProgramDate, type ProgramDraft } from "@/lib/programs/draft";
type Option = { id: string; name: string };
export function ProgramForm({
  disciplines,
  instructors,
  spaces,
  kind,
}: {
  disciplines: Option[];
  instructors: Option[];
  spaces: Option[];
  kind: "workshop" | "event" | "masterclass";
}) {
  const [draft, setDraft] = useState<ProgramDraft>({
    name: "",
    description: "",
    kind,
    fullPriceMinor: 0,
    allowSingle: false,
    dates: [
      {
        date: "",
        time: "10:00",
        disciplineId: disciplines[0]?.id ?? "",
        durationMinutes: 60,
        capacity: 5,
        priceMinor: 0,
        instructorId: "",
        spaceId: "",
      },
    ],
  });
  const [state, action, pending] = useActionState(createProgram, { error: null });
  function patchDate(index: number, patch: Partial<ProgramDate>) {
    setDraft((current) => ({
      ...current,
      dates: current.dates.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }
  return (
    <form action={action} className="activities-stage">
      <h2>{kind === "masterclass" ? "Información de la master class" : kind === "event" ? "Información del evento" : "Información del programa"}</h2>
      <input type="hidden" name="payload" value={JSON.stringify(draft)} />
      <div className="activities-form-grid">
        <label className="activities-field">
          <span>Nombre</span>
          <input
            required
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="activities-field activities-field-wide">
          <span>Descripción</span>
          <textarea
            maxLength={500}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label className="activities-field">
          <span>Precio completo</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.fullPriceMinor / 100 || ""}
            onChange={(e) =>
              setDraft({ ...draft, fullPriceMinor: Math.round(Number(e.target.value) * 100) })
            }
          />
        </label>
        {draft.dates.length > 1 ? (
          <label className="activities-field">
            <span>
              <input
                type="checkbox"
                checked={draft.allowSingle}
                onChange={(e) => setDraft({ ...draft, allowSingle: e.target.checked })}
              />{" "}
              Permitir asistir a días sueltos
            </span>
          </label>
        ) : (
          <p>Una sola fecha: se vende el evento completo.</p>
        )}
      </div>
      <h2>Fechas, horarios y cupos</h2>
      <p>
        Cada fecha genera una sesión en Agenda. Puedes repetir la disciplina o cambiarla en cada
        día.
      </p>
      {draft.dates.map((row, index) => (
        <fieldset
          key={index}
          style={{ margin: "16px 0", padding: 16, border: "1px solid #ddd", borderRadius: 12 }}
        >
          <legend>Fecha {index + 1}</legend>
          <div className="activities-form-grid">
            <label className="activities-field">
              <span>Fecha</span>
              <input
                type="date"
                required
                value={row.date}
                onChange={(e) => patchDate(index, { date: e.target.value })}
              />
            </label>
            <label className="activities-field">
              <span>Hora</span>
              <input
                type="time"
                required
                value={row.time}
                onChange={(e) => patchDate(index, { time: e.target.value })}
              />
            </label>
            <label className="activities-field">
              <span>Disciplina</span>
              <select
                required
                value={row.disciplineId}
                onChange={(e) => patchDate(index, { disciplineId: e.target.value })}
              >
                <option value="">Seleccionar</option>
                {disciplines.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="activities-field">
              <span>Duración (minutos)</span>
              <input
                type="number"
                required
                min={15}
                max={360}
                value={row.durationMinutes}
                onChange={(e) => patchDate(index, { durationMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="activities-field">
              <span>Cupo</span>
              <input
                type="number"
                required
                min={1}
                value={row.capacity}
                onChange={(e) => patchDate(index, { capacity: Number(e.target.value) })}
              />
            </label>
            {draft.allowSingle && draft.dates.length > 1 ? (
              <label className="activities-field">
                <span>Precio de este día</span>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={row.priceMinor / 100 || ""}
                  onChange={(e) =>
                    patchDate(index, { priceMinor: Math.round(Number(e.target.value) * 100) })
                  }
                />
              </label>
            ) : null}
            <label className="activities-field">
              <span>Coach</span>
              <select
                value={row.instructorId}
                onChange={(e) => patchDate(index, { instructorId: e.target.value })}
              >
                <option value="">Por asignar</option>
                {instructors.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="activities-field">
              <span>Espacio</span>
              <select
                value={row.spaceId}
                onChange={(e) => patchDate(index, { spaceId: e.target.value })}
              >
                <option value="">Por asignar</option>
                {spaces.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {draft.dates.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  dates: draft.dates.filter((_, i) => i !== index),
                  allowSingle: draft.dates.length > 2 && draft.allowSingle,
                })
              }
            >
              Quitar esta fecha
            </button>
          ) : null}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={draft.dates.length >= 100}
        onClick={() => {
          const last = draft.dates[draft.dates.length - 1];
          setDraft({
            ...draft,
            dates: [...draft.dates, { ...last, date: followingWeek(last.date) }],
          });
        }}
      >
        ＋ Agregar fecha (una semana después)
      </button>
      <p>
        La compra completa reserva todas las fechas. Si habilitas fechas individuales, cada
        reserva utiliza el cupo de su sesión.
      </p>
      {state.error ? (
        <p role="alert" className="activities-inline-error">
          {state.error}
        </p>
      ) : null}
      <button className="activities-next-button" disabled={pending} type="submit">
        {pending ? "Guardando…" : kind === "masterclass" ? "Crear master class" : kind === "event" ? "Crear evento" : "Crear programa y sesiones"}
      </button>
    </form>
  );
}
