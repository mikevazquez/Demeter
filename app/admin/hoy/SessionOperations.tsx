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
        {open ? "Cerrar operación" : "Abrir clase"}
      </button>
      {open ? (
        <div className="today-session-drawer">
          <div className="today-roster">
            <div className="today-drawer-heading">
              <strong>Alumnas reservadas</strong>
              <span>{roster.length} en roster</span>
            </div>
            {roster.length ? (
              roster.map((item) => (
                <div className="today-roster-row" key={item.id}>
                  <div className="today-roster-main">
                    <strong>{item.studentName}</strong>
                    <span>{item.packageLabel}</span>
                  </div>
                  <div className="today-roster-package">
                    <span>{item.creditsLabel}</span>
                    <span>{item.expiresLabel}</span>
                  </div>
                  <span className="status-pill">{item.status === "attended" ? "Asistió" : "Reservada"}</span>
                  {canEdit && item.status === "reserved" ? (
                    <form action={cancelReservationFromToday}>
                      <input type="hidden" name="session_id" value={sessionId} />
                      <input type="hidden" name="reservation_id" value={item.id} />
                      <input type="hidden" name="return_date" value={returnDate} />
                      <button className="today-inline-danger" type="submit">
                        Cancelar
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="today-drawer-empty">Todavía no hay alumnas reservadas.</div>
            )}
          </div>

          {canEdit ? (
            <div className="today-walkin">
              <div className="today-drawer-heading">
                <div>
                  <strong>Agregar walk-in o alumna</strong>
                  <span>Usa las mismas reglas de reserva y créditos de F7.</span>
                </div>
                <span>{available} lugares libres</span>
              </div>
              {available <= 0 ? (
                <div className="today-drawer-empty">Clase llena. No se permiten sobrecupos automáticos.</div>
              ) : (
                <form action={bookStudentFromToday} className="today-walkin-form">
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  <select name="student_id" defaultValue="" required>
                    <option value="" disabled>
                      Selecciona una alumna
                    </option>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id} disabled={!candidate.eligible}>
                        {candidate.fullName} · {candidate.detail}
                      </option>
                    ))}
                  </select>
                  <button className="primary-button" type="submit" disabled={!eligibleCount}>
                    Reservar ahora
                  </button>
                </form>
              )}
              {!candidates.length ? (
                <small>No hay más alumnas activas disponibles para esta clase.</small>
              ) : null}
              {candidates.length > 0 && !eligibleCount ? (
                <small>Ninguna alumna disponible cumple actualmente las reglas de paquete, disciplina y créditos.</small>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
