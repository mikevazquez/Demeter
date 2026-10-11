"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import PortalSheet from "@/app/admin/components/PortalSheet";
import type { CalendarEvent } from "@/lib/holidays/calendar";
import { saveCalendarEventAction } from "./actions";

export type CalendarSession = {
  id: string;
  date: string;
  name: string;
  time: string;
  reservations: number;
  status: string;
};
export default function CalendarEventEditor({
  event,
  decisions,
  sessions,
  year,
  today,
}: {
  event: CalendarEvent;
  decisions: {
    holiday_date: string;
    operation_mode: string;
    student_message: string | null;
    special_recurring_schedule_ids: string[];
  }[];
  sessions: CalendarSession[];
  year: number;
  today: string;
}) {
  const router = useRouter();
  const close = useCallback(
    () => router.push(`/admin/configuracion/festivos?year=${year}`, { scroll: false }),
    [router, year],
  );
  const [modes, setModes] = useState(() =>
    Object.fromEntries(
      event.days.map((day) => [
        day.date,
        decisions.find((d) => d.holiday_date === day.date)?.operation_mode ?? day.suggest,
      ]),
    ),
  );
  const [keep, setKeep] = useState(
    () => new Set(sessions.filter((s) => s.status !== "cancelled").map((s) => s.id)),
  );
  const affected = sessions.filter(
    (s) =>
      s.status !== "cancelled" &&
      s.date >= today &&
      (modes[s.date] === "closed" || (modes[s.date] === "special" && !keep.has(s.id))),
  );
  const [confirmed, setConfirmed] = useState(false);
  return (
    <PortalSheet title={event.name} onClose={close}>
      <p className="portal-muted">
        Decide cómo opera el estudio en cada día. Las sugerencias no se aplican hasta que guardes.
      </p>
      <form
        action={saveCalendarEventAction}
        onSubmit={(e) => {
          if (affected.length && !confirmed) {
            e.preventDefault();
            setConfirmed(true);
          }
        }}
        className="portal-calendar-form"
      >
        <input type="hidden" name="event_id" value={event.id} />
        <input type="hidden" name="year" value={year} />
        <div className="portal-calendar-presets">
          <button
            type="button"
            onClick={() => {
              setModes(Object.fromEntries(event.days.map((d) => [d.date, "normal"])));
              setConfirmed(false);
            }}
          >
            Todos abiertos
          </button>
          <button
            type="button"
            onClick={() => {
              setModes(Object.fromEntries(event.days.map((d) => [d.date, "closed"])));
              setConfirmed(false);
            }}
          >
            Todos cerrados
          </button>
        </div>
        {event.days.map((day) => (
          <fieldset key={day.date} className="portal-calendar-day">
            <legend>
              {new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              }).format(new Date(day.date + "T12:00:00Z"))}{" "}
              · {day.name}
            </legend>
            <select
              disabled={day.date < today}
              aria-label={`Operación del ${day.date}`}
              name={`mode_${day.date}`}
              value={modes[day.date]}
              onChange={(e) => {
                setModes({ ...modes, [day.date]: e.target.value });
                setConfirmed(false);
              }}
            >
              <option value="normal">Abierto · horario normal</option>
              <option value="closed">Estudio cerrado</option>
              <option value="special">Horario especial</option>
            </select>
            {modes[day.date] === "special" ? (
              <div className="portal-calendar-sessions">
                <p>Marca las sesiones que sí se impartirán.</p>
                {sessions
                  .filter((s) => s.date === day.date)
                  .map((s) => (
                    <label key={s.id}>
                      <input
                        disabled={day.date < today}
                        type="checkbox"
                        name={`keep_${day.date}`}
                        value={s.id}
                        checked={keep.has(s.id)}
                        onChange={(e) => {
                          const next = new Set(keep);
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          setKeep(next);
                          setConfirmed(false);
                        }}
                      />
                      <span>
                        <b>
                          {s.time} · {s.name}
                        </b>
                        <small>{s.reservations} reservadas</small>
                      </span>
                    </label>
                  ))}
                {!sessions.some((s) => s.date === day.date) ? (
                  <p>No hay sesiones para este día.</p>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        ))}
        <label>
          Mensaje para las alumnas
          <textarea
            name="message"
            rows={4}
            defaultValue={
              decisions.find((d) => d.student_message)?.student_message ?? event.message
            }
          />
        </label>
        <p className="portal-muted">
          Las reservas canceladas devuelven sus créditos. Al cambiar la decisión se reabren las
          sesiones; las reservas anteriores siguen canceladas.
        </p>
        {confirmed ? (
          <div className="notice error">
            Se cancelarán {affected.length} clases con{" "}
            {affected.reduce((n, s) => n + s.reservations, 0)} reservas. Revisa el horario antes de
            confirmar.
          </div>
        ) : null}
        <button type="submit" className="primary-button">
          {confirmed ? "Confirmar y guardar" : "Guardar decisión"}
        </button>
      </form>
    </PortalSheet>
  );
}
