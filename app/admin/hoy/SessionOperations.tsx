"use client";

import { useEffect, useState } from "react";

import {
  bookStudentFromToday,
  cancelReservationFromToday,
  finalizeAttendanceFromToday,
  setAttendanceFromToday,
} from "../actions";

type RosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
};

type Candidate = { id: string; fullName: string; eligible: boolean; detail: string };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function SessionOperations({ sessionId, returnDate, roster, candidates, available, canEdit }: {
  sessionId: string; returnDate: string; roster: RosterItem[]; candidates: Candidate[]; available: number; canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;
  const attendanceCount = roster.filter((item) => item.status === "attended").length;
  const noShowCount = roster.filter((item) => item.status === "no_show").length;
  const pendingCount = roster.filter((item) => item.status === "reserved").length;

  useEffect(() => {
    if (window.location.hash !== `#session-${sessionId}`) return;
    setOpen(true);
    const params = new URLSearchParams(window.location.search);
    const created = params.get("created");
    const error = params.get("error");
    if (created) setFeedback({ kind: "success", message: created === "attendance-finalized" ? "Asistencia finalizada correctamente." : created === "attended" ? "Asistencia registrada." : created === "no_show" ? "No-show registrado." : created === "cancel" ? "Reserva cancelada correctamente." : "Reserva creada correctamente." });
    else if (error) setFeedback({ kind: "error", message: error === "correction_reason_required" ? "La corrección requiere un motivo." : "No se pudo completar la operación." });
  }, [sessionId]);

  return <div className="today-session-operations" id={`session-${sessionId}`}>
    <button className="today-session-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Cerrar clase" : `Ver alumnas · ${roster.length}`}</button>
    {open ? <div className="today-session-drawer roster-first">
      {feedback ? <div className={`notice ${feedback.kind}`} role="status">{feedback.message}</div> : null}
      <section className="today-roster roster-priority">
        <div className="today-roster-header"><div><span className="today-roster-kicker">ASISTENCIA</span><h3>Lista de clase</h3></div><div className="today-roster-count"><strong>{attendanceCount}</strong><span>asistieron · {noShowCount} no-show · {pendingCount} pendientes</span></div></div>
        {roster.length ? <div className="today-student-list">{roster.map((item) => <article className="today-student-card" key={item.id}>
          <div className="today-student-avatar" aria-hidden="true">{initials(item.studentName)}</div>
          <div className="today-student-identity"><strong>{item.studentName}</strong><span>{item.packageLabel}</span></div>
          <div className="today-student-balance"><strong>{item.creditsLabel}</strong><span>{item.expiresLabel}</span></div>
          {canEdit && ["reserved", "attended", "no_show"].includes(item.status) ? <div className="today-attendance-preview">
            <form action={setAttendanceFromToday}><input type="hidden" name="session_id" value={sessionId}/><input type="hidden" name="reservation_id" value={item.id}/><input type="hidden" name="return_date" value={returnDate}/><input type="hidden" name="status" value="attended"/><button type="submit" disabled={item.status === "attended"}>✓ Asistió</button></form>
            <form action={setAttendanceFromToday}><input type="hidden" name="session_id" value={sessionId}/><input type="hidden" name="reservation_id" value={item.id}/><input type="hidden" name="return_date" value={returnDate}/><input type="hidden" name="status" value="no_show"/><button type="submit" disabled={item.status === "no_show"}>No show</button></form>
          </div> : <span className="status-pill">{item.status === "attended" ? "Asistió" : item.status === "no_show" ? "No show" : "Reservada"}</span>}
          {canEdit && item.status === "reserved" ? <form action={cancelReservationFromToday} className="today-cancel-form"><input type="hidden" name="session_id" value={sessionId}/><input type="hidden" name="reservation_id" value={item.id}/><input type="hidden" name="return_date" value={returnDate}/><button className="today-inline-danger" type="submit">Cancelar reserva</button></form> : null}
        </article>)}</div> : <div className="today-drawer-empty">Todavía no hay alumnas en la lista.</div>}
      </section>
      {canEdit ? <section className="today-walkin add-student-secondary"><div className="today-drawer-heading"><div><strong>Agregar walk-in</strong><span>Agrega una alumna existente a esta clase.</span></div></div>{available <= 0 ? <div className="today-drawer-empty">La clase ya está llena.</div> : <form action={bookStudentFromToday} className="today-walkin-form"><input type="hidden" name="session_id" value={sessionId}/><input type="hidden" name="return_date" value={returnDate}/><select name="student_id" defaultValue="" required><option value="" disabled>Selecciona una alumna</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={!candidate.eligible}>{candidate.fullName} · {candidate.detail}</option>)}</select><button className="primary-button" type="submit" disabled={!eligibleCount}>Agregar a la clase</button></form>}</section> : null}
      {canEdit && roster.length ? <section className="today-walkin"><div className="today-drawer-heading"><div><strong>Resumen</strong><span>{attendanceCount} asistieron · {noShowCount} no-show · {pendingCount} pendientes. Al finalizar, los pendientes se registran como no-show y se resuelven los créditos.</span></div></div><form action={finalizeAttendanceFromToday}><input type="hidden" name="session_id" value={sessionId}/><input type="hidden" name="return_date" value={returnDate}/><button className="primary-button" type="submit">Finalizar asistencia</button></form></section> : null}
    </div> : null}
  </div>;
}
