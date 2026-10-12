"use client";

import { useActionState } from "react";
import { saveDemiTemporaryInformation, type TemporaryInformationActionState } from "./actions";

type FormItem = {
  id: string;
  title: string;
  kind: "workshop" | "promotion" | "event";
  discipline: string | null;
  details: string;
  promotion_starts_on: string;
  event_starts_on: string;
  event_ends_on: string;
  registration_deadline: string | null;
  status: "draft" | "published" | "archived";
};

const initialState: TemporaryInformationActionState = {};

export default function TemporaryInformationForm({ item }: { item?: FormItem | null }) {
  const [state, action, pending] = useActionState(saveDemiTemporaryInformation, initialState);
  return (
    <form action={action} className="demi-temporary-form">
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <div className="demi-temporary-grid">
        <label>
          Nombre del evento o promoción
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={item?.title ?? ""}
            placeholder="Taller de aro aéreo"
          />
        </label>
        <label>
          Tipo
          <select name="kind" defaultValue={item?.kind ?? "workshop"}>
            <option value="workshop">Taller</option>
            <option value="event">Evento</option>
            <option value="promotion">Promoción</option>
          </select>
        </label>
        <label>
          Disciplina (opcional)
          <input
            name="discipline"
            maxLength={120}
            defaultValue={item?.discipline ?? ""}
            placeholder="Aro aéreo"
          />
        </label>
        <label>
          Desde cuándo puede anunciarlo Demi
          <input
            name="promotion_starts_on"
            type="date"
            required
            defaultValue={item?.promotion_starts_on ?? ""}
          />
        </label>
        <label>
          Inicio del evento o taller
          <input
            name="event_starts_on"
            type="date"
            required
            defaultValue={item?.event_starts_on ?? ""}
          />
        </label>
        <label>
          Último día del evento o taller
          <input
            name="event_ends_on"
            type="date"
            required
            defaultValue={item?.event_ends_on ?? ""}
          />
        </label>
        <label className="demi-temporary-wide">
          Fecha límite para inscribirse (opcional)
          <input
            name="registration_deadline"
            type="date"
            defaultValue={item?.registration_deadline ?? ""}
          />
          <small>
            Si la dejas vacía, Demi seguirá respondiendo hasta el último día del evento.
          </small>
        </label>
        <label className="demi-temporary-wide">
          Información para responder
          <textarea
            name="details"
            required
            maxLength={5000}
            rows={7}
            defaultValue={item?.details ?? ""}
            placeholder="Incluye horarios, precio, ubicación, requisitos, forma de inscripción y cualquier condición importante."
          />
        </label>
        <label>
          Estado
          <select name="status" defaultValue={item?.status ?? "draft"}>
            <option value="draft">Borrador · Demi no lo comparte</option>
            <option value="published">Visible para Demi dentro de las fechas</option>
            <option value="archived">Archivado</option>
          </select>
        </label>
      </div>
      {state.error && (
        <p className="demi-temporary-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="demi-temporary-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Guardando…" : item ? "Guardar cambios" : "Guardar información"}
        </button>
      </div>
    </form>
  );
}
