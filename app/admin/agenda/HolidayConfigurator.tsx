"use client";

import { useMemo, useState } from "react";

import { getHolidayTheme, holidayOperationLabel } from "@/lib/holidays/theme";

import { saveHolidayOperation } from "./holiday-actions";

type Holiday = {
  id: string;
  holiday_date: string;
  name: string;
  theme_key: string;
  default_message: string;
  source_label: string;
  source_url: string;
  legal_basis: string;
};

type Session = {
  id: string;
  name: string;
  time: string;
  instructor: string;
  space: string;
  status: string;
  reservations: number;
};

export function HolidayConfigurator({
  holiday,
  operationMode,
  studentMessage,
  sessions,
  defaultKeepSessionIds,
  canEdit,
  saved,
}: {
  holiday: Holiday;
  operationMode: "normal" | "closed" | "special";
  studentMessage: string;
  sessions: Session[];
  defaultKeepSessionIds: string[];
  canEdit: boolean;
  saved?: boolean;
}) {
  const theme = getHolidayTheme(holiday.theme_key);
  const [mode, setMode] = useState(operationMode);
  const [message, setMessage] = useState(studentMessage);
  const [keepIds, setKeepIds] = useState(() => new Set(defaultKeepSessionIds));
  const activeSessions = sessions.filter((session) => session.status === "scheduled");
  const totalReservations = sessions.reduce((sum, session) => sum + session.reservations, 0);
  const affectedSessions = mode === "closed"
    ? sessions.length
    : mode === "special"
      ? sessions.filter((session) => !keepIds.has(session.id)).length
      : 0;
  const affectedReservations = mode === "closed"
    ? totalReservations
    : mode === "special"
      ? sessions
          .filter((session) => !keepIds.has(session.id))
          .reduce((sum, session) => sum + session.reservations, 0)
      : 0;

  const summary = useMemo(() => {
    if (mode === "closed") return "No habrá clases disponibles este día.";
    if (mode === "special") return "Solo se mantendrán las sesiones seleccionadas.";
    return "Las clases se impartirán como de costumbre.";
  }, [mode]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (mode === "normal" || (affectedSessions === 0 && affectedReservations === 0)) return;
    const message =
      mode === "closed"
        ? `Este cambio cancelará ${affectedSessions} sesión(es) y afectará ${affectedReservations} reserva(s). Los créditos aplicables se restaurarán. ¿Confirmas el cierre?`
        : `Este horario especial cancelará ${affectedSessions} sesión(es) y afectará ${affectedReservations} reserva(s). ¿Confirmas el cambio?`;
    if (!window.confirm(message)) event.preventDefault();
  };

  return (
    <section
      className="agenda-holiday-panel"
      data-theme={holiday.theme_key}
      style={
        {
          "--holiday-accent": theme.accent,
          "--holiday-secondary": theme.secondary,
        } as React.CSSProperties
      }
    >
      <div className="agenda-holiday-heading">
        <span className="agenda-holiday-icon" aria-hidden="true">
          {theme.icon}
        </span>
        <div>
          <small>FESTIVO OFICIAL</small>
          <h2>{holiday.name}</h2>
          <p>
            {holiday.legal_basis} · {holiday.source_label}
          </p>
        </div>
        <span className={`agenda-holiday-mode is-${operationMode}`}>
          {holidayOperationLabel(operationMode)}
        </span>
      </div>

      {saved ? (
        <div className="agenda-holiday-saved">Configuración del festivo guardada.</div>
      ) : null}

      <form action={saveHolidayOperation} onSubmit={onSubmit} className="agenda-holiday-form">
        <input type="hidden" name="holiday_date" value={holiday.holiday_date} />

        <fieldset disabled={!canEdit} className="agenda-holiday-options">
          <legend>¿Cómo operará el estudio?</legend>
          {[
            {
              value: "normal",
              title: "Horario normal",
              detail: "Las clases se impartirán como de costumbre.",
            },
            {
              value: "closed",
              title: "Estudio cerrado",
              detail: "No habrá clases disponibles este día.",
            },
            {
              value: "special",
              title: "Horario especial",
              detail: "Selecciona qué clases estarán disponibles.",
            },
          ].map((option) => (
            <label
              key={option.value}
              className={`agenda-holiday-option${mode === option.value ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name="operation_mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value as typeof mode)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === "special" ? (
          <div className="agenda-holiday-special">
            <div className="agenda-holiday-special-heading">
              <div>
                <strong>Sesiones de este día</strong>
                <small>Activa únicamente las que sí se impartirán.</small>
              </div>
              {sessions.length ? (
                <button
                  type="button"
                  onClick={() =>
                    setKeepIds(
                      keepIds.size === sessions.length
                        ? new Set()
                        : new Set(sessions.map((session) => session.id)),
                    )
                  }
                >
                  {keepIds.size === sessions.length ? "Quitar todas" : "Mantener todas"}
                </button>
              ) : null}
            </div>

            {sessions.length ? (
              <div className="agenda-holiday-session-list">
                {sessions.map((session) => {
                  const checked = keepIds.has(session.id);
                  return (
                    <label key={session.id} className={checked ? "is-kept" : ""}>
                      <input
                        type="checkbox"
                        name="keep_session_id"
                        value={session.id}
                        checked={checked}
                        onChange={(event) => {
                          setKeepIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(session.id);
                            else next.delete(session.id);
                            return next;
                          });
                        }}
                      />
                      <span className="agenda-holiday-session-time">{session.time}</span>
                      <span className="agenda-holiday-session-copy">
                        <strong>{session.name}</strong>
                        <small>
                          {session.instructor} · {session.space}
                        </small>
                      </span>
                      <span className="agenda-holiday-session-reservations">
                        {session.reservations} reserva{session.reservations === 1 ? "" : "s"}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="agenda-holiday-no-sessions">
                No hay sesiones materializadas para este día. Puedes crear una sesión extraordinaria
                desde la Agenda después de guardar el horario especial.
              </p>
            )}
          </div>
        ) : null}

        {mode !== "normal" ? (
          <div className="agenda-holiday-impact">
            <strong>Este cambio afectará</strong>
            <div>
              <span>
                <b>{affectedSessions}</b>
                <small>sesiones</small>
              </span>
              <span>
                <b>{affectedReservations}</b>
                <small>reservas</small>
              </span>
              <span>
                <b>{new Set(sessions.map((session) => session.instructor).filter(Boolean)).size}</b>
                <small>coaches</small>
              </span>
              <span>
                <b>{new Set(sessions.map((session) => session.space).filter(Boolean)).size}</b>
                <small>espacios</small>
              </span>
            </div>
            <p>
              {summary} Las reservas canceladas seguirán el flujo normal de devolución de crédito,
              liberación de recurso y notificación.
            </p>
          </div>
        ) : null}

        <label className="agenda-holiday-message">
          <span>Mensaje temático para alumnas</span>
          <textarea
            name="student_message"
            value={message}
            maxLength={500}
            onChange={(event) => setMessage(event.target.value)}
            disabled={!canEdit}
            rows={3}
          />
          <small>{message.length}/500</small>
        </label>

        <div className="agenda-holiday-footer">
          <a href={holiday.source_url} target="_blank" rel="noreferrer">
            Ver fuente oficial ↗
          </a>
          {canEdit ? <button type="submit">Guardar operación</button> : null}
        </div>
      </form>
    </section>
  );
}
