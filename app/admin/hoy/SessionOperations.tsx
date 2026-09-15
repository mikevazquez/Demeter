"use client";

import { useState } from "react";

import { bookStudentFromToday, cancelReservationFromToday } from "../actions";

type RosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
};

type Candidate = {
  id: string;
  fullName: string;
  eligible: boolean;
  detail: string;
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function SessionOperations({
  sessionId,
  returnDate,
  roster,
  candidates,
  available,
  canEdit,
}: {
  sessionId: string;
  returnDate: string;
  roster: RosterItem[];
  candidates: Candidate[];
  available: number;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;

  return (
    <div className="today-session-operations">
      <button
        className="today-session-toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Cerrar clase" : `Ver alumnas · ${roster.length}`}
      </button>
      {open ? (
        <div className="today-session-drawer roster-first">
          <section className="today-roster roster-priority">
            <div className="today-roster-header">
              <div>
                <span className="today-roster-kicker">ROSTER</span>
                <h3>Alumnas reservadas</h3>
              </div>
              <div className="today-roster-count">
                <strong>{roster.length}</strong>
                <span>reservadas · {available} lugares libres</span>
              </div>
            </div>
            {roster.length ? (
              <div className="today-student-list">
                {roster.map((item) => (
                  <article className="today-student-card" key={item.id}>
                    <div className="today-student-avatar" aria-hidden="true">
                      {initials(item.studentName)}
                    </div>
                    <div className="today-student-identity">
                      <strong>{item.studentName}</strong>
                      <span>{item.packageLabel}</span>
                    </div>
                    <div className="today-student-balance">
                      <strong>{item.creditsLabel}</strong>
                      <span>{item.expiresLabel}</span>
                    </div>
                    <div
                      className="today-attendance-preview"
                      aria-label="Acciones de asistencia disponibles en F8"
                    >
                      <button type="button" disabled title="Se habilita en F8">
                        ✓ Asistió
                      </button>
                      <button type="button" disabled title="Se habilita en F8">
                        No show
                      </button>
                    </div>
                    {canEdit && item.status === "reserved" ? (
                      <form action={cancelReservationFromToday} className="today-cancel-form">
                        <input type="hidden" name="session_id" value={sessionId} />
                        <input type="hidden" name="reservation_id" value={item.id} />
                        <input type="hidden" name="return_date" value={returnDate} />
                        <button className="today-inline-danger" type="submit">
                          Cancelar reserva
                        </button>
                      </form>
                    ) : (
                      <span className="status-pill">
                        {item.status === "attended" ? "Asistió" : "Reservada"}
                      </span>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="today-drawer-empty">Todavía no hay alumnas reservadas.</div>
            )}
          </section>

          {canEdit ? (
            <section className="today-walkin add-student-secondary">
              <div className="today-drawer-heading">
                <div>
                  <strong>Agregar alumna</strong>
                  <span>Reserva un lugar para una alumna activa.</span>
                </div>
              </div>
              {available <= 0 ? (
                <div className="today-drawer-empty">La clase ya está llena.</div>
              ) : (
                <form action={bookStudentFromToday} className="today-walkin-form">
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  <select name="student_id" defaultValue="" required>
                    <option value="" disabled>
                      Selecciona una alumna
                    </option>
                    {candidates.map((candidate) => (
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        disabled={!candidate.eligible}
                      >
                        {candidate.fullName} · {candidate.detail}
                      </option>
                    ))}
                  </select>
                  <button className="primary-button" type="submit" disabled={!eligibleCount}>
                    Agregar a la clase
                  </button>
                </form>
              )}
              {!candidates.length ? <small>No hay más alumnas activas disponibles.</small> : null}
              {candidates.length > 0 && !eligibleCount ? (
                <small>Ninguna alumna disponible puede reservar esta clase actualmente.</small>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
