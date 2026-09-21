"use client";

import { useEffect, useState } from "react";

import {
  bookStudentFromToday,
  cancelReservationFromToday,
  createWalkinFromToday,
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

type Candidate = {
  id: string;
  fullName: string;
  eligible: boolean;
  detail: string;
};

type SessionOperationsProps = {
  sessionId: string;
  returnDate: string;
  sessionStatus: string;
  roster: RosterItem[];
  candidates: Candidate[];
  available: number;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
  returnTo?: string;
  initiallyOpen?: boolean;
  showToggle?: boolean;
};

const walkinFallbackDetails = new Set(["sin paquete activo", "fuera de paquete", "sin créditos"]);

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function attendanceLabel(status: string) {
  if (status === "attended") return "Asistió";
  if (status === "no_show") return "No show";
  return "Reservada";
}

export function SessionOperations({
  sessionId,
  returnDate,
  sessionStatus,
  roster,
  candidates,
  available,
  canAttendance,
  canBook,
  canCreateStudent,
  returnTo = "",
  initiallyOpen = false,
  showToggle = true,
}: SessionOperationsProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [newWalkin, setNewWalkin] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const isCompleted = sessionStatus === "completed";
  const canAddExisting = !isCompleted && canBook;
  const canAddNew = !isCompleted && canCreateStudent;
  const canAddWalkin = canAddExisting || canAddNew;
  const showNewWalkin = canAddNew && (newWalkin || !canAddExisting);
  const attendanceCount = roster.filter((item) => item.status === "attended").length;
  const noShowCount = roster.filter((item) => item.status === "no_show").length;
  const pendingCount = roster.filter((item) => item.status === "reserved").length;

  useEffect(() => {
    const matchesSessionHash = window.location.hash === `#session-${sessionId}`;
    if (showToggle && !matchesSessionHash) return;

    const frame = window.requestAnimationFrame(() => {
      if (matchesSessionHash) setOpen(true);
      const params = new URLSearchParams(window.location.search);
      const created = params.get("created");
      const error = params.get("error");

      if (created) {
        if (created === "attended" || created === "no_show") {
          setFeedback(null);
        } else {
          setFeedback({
            kind: "success",
            message:
              created === "attendance-finalized"
                ? "Asistencia finalizada correctamente."
                : created === "attendance-corrected"
                  ? "Corrección registrada con motivo y trazabilidad."
                  : created === "walkin"
                    ? "Walk-in registrada y agregada a la clase."
                    : created === "walkin-existing"
                      ? "Alumna agregada como walk-in. La venta o paquete queda pendiente."
                      : created === "cancel"
                        ? "Reserva cancelada correctamente."
                        : "Reserva creada correctamente.",
          });
        }
      } else if (error) {
        setFeedback({
          kind: "error",
          message:
            error === "correction_reason_required"
              ? "La corrección requiere un motivo."
              : error === "phone_exists"
                ? "Ese teléfono ya pertenece a una alumna. Agrégala como alumna existente."
                : error === "session_full"
                  ? "La clase ya está llena."
                  : error === "enrollment_required"
                    ? "La alumna necesita una inscripción vigente para reservar esta clase."
                    : "No se pudo completar la operación.",
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [sessionId, showToggle]);

  return (
    <div
      className={`today-session-operations${showToggle ? "" : " is-detail"}`}
      id={`session-${sessionId}`}
    >
      {showToggle ? (
        <button
          className="today-session-toggle"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Cerrar clase" : `Ver alumnas · ${roster.length}`}
        </button>
      ) : null}

      {open ? (
        <div className="today-session-drawer roster-first">
          {feedback ? (
            <div className={`notice ${feedback.kind}`} role="status">
              {feedback.message}
            </div>
          ) : null}

          <section className="today-roster roster-priority">
            <div className="today-roster-header">
              <div>
                <span className="today-roster-kicker">ASISTENCIA</span>
                <h3>Lista de clase</h3>
              </div>
              <div className="today-roster-count">
                <strong>{attendanceCount}</strong>
                <span>
                  asistieron · {noShowCount} no-show · {pendingCount} pendientes
                </span>
              </div>
            </div>

            {roster.length ? (
              <div className="today-student-list">
                {roster.map((item) => {
                  const canCorrect =
                    isCompleted && canAttendance && ["attended", "no_show"].includes(item.status);
                  const correctionTarget = item.status === "attended" ? "no_show" : "attended";

                  return (
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

                      {!isCompleted &&
                      canAttendance &&
                      ["reserved", "attended", "no_show"].includes(item.status) ? (
                        <div className="today-attendance-preview">
                          <form action={setAttendanceFromToday}>
                            <input type="hidden" name="session_id" value={sessionId} />
                            <input type="hidden" name="reservation_id" value={item.id} />
                            <input type="hidden" name="return_date" value={returnDate} />
                            {returnTo ? (
                              <input type="hidden" name="return_to" value={returnTo} />
                            ) : null}
                            <input type="hidden" name="status" value="attended" />
                            <button
                              className={
                                item.status === "attended" ? "is-selected is-attended" : ""
                              }
                              type="submit"
                              disabled={item.status === "attended"}
                              aria-pressed={item.status === "attended"}
                            >
                              ✓ Asistió
                            </button>
                          </form>
                          <form action={setAttendanceFromToday}>
                            <input type="hidden" name="session_id" value={sessionId} />
                            <input type="hidden" name="reservation_id" value={item.id} />
                            <input type="hidden" name="return_date" value={returnDate} />
                            {returnTo ? (
                              <input type="hidden" name="return_to" value={returnTo} />
                            ) : null}
                            <input type="hidden" name="status" value="no_show" />
                            <button
                              className={item.status === "no_show" ? "is-selected is-no-show" : ""}
                              type="submit"
                              disabled={item.status === "no_show"}
                              aria-pressed={item.status === "no_show"}
                            >
                              No show
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="status-pill">{attendanceLabel(item.status)}</span>
                      )}

                      {canCorrect ? (
                        <div className="today-walkin-form">
                          <div className="today-drawer-heading">
                            <div>
                              <strong>Corrección</strong>
                              <span>
                                La sesión está finalizada. El cambio requiere motivo y quedará
                                registrado.
                              </span>
                            </div>
                          </div>
                          <form action={setAttendanceFromToday} className="today-walkin-form">
                            <input type="hidden" name="session_id" value={sessionId} />
                            <input type="hidden" name="reservation_id" value={item.id} />
                            <input type="hidden" name="return_date" value={returnDate} />
                            {returnTo ? (
                              <input type="hidden" name="return_to" value={returnTo} />
                            ) : null}
                            <input type="hidden" name="status" value={correctionTarget} />
                            <input
                              name="reason"
                              placeholder="Motivo de la corrección"
                              required
                              aria-label="Motivo de la corrección"
                            />
                            <button className="secondary-button" type="submit">
                              Corregir a {correctionTarget === "attended" ? "Asistió" : "No show"}
                            </button>
                          </form>
                        </div>
                      ) : null}

                      {!isCompleted && canBook && item.status === "reserved" ? (
                        <form action={cancelReservationFromToday} className="today-cancel-form">
                          <input type="hidden" name="session_id" value={sessionId} />
                          <input type="hidden" name="reservation_id" value={item.id} />
                          <input type="hidden" name="return_date" value={returnDate} />
                          {returnTo ? (
                            <input type="hidden" name="return_to" value={returnTo} />
                          ) : null}
                          <button className="today-inline-danger" type="submit">
                            Cancelar reserva
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="today-drawer-empty">Todavía no hay alumnas en la lista.</div>
            )}
          </section>

          {canAddWalkin ? (
            <section className="today-walkin add-student-secondary">
              <div className="today-drawer-heading">
                <div>
                  <strong>Walk-in</strong>
                  <span>Agrega una alumna existente o registra una nueva con datos mínimos.</span>
                </div>
                {canAddExisting && canAddNew ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setNewWalkin((value) => !value)}
                  >
                    {showNewWalkin ? "Usar existente" : "Nueva alumna"}
                  </button>
                ) : null}
              </div>

              {available <= 0 ? (
                <div className="today-drawer-empty">La clase ya está llena.</div>
              ) : showNewWalkin ? (
                <form action={createWalkinFromToday} className="today-walkin-form">
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
                  <input name="first_name" placeholder="Nombre" required />
                  <input name="last_name" placeholder="Apellido" />
                  <input name="phone" type="tel" placeholder="Teléfono" required />
                  <small>
                    Se crea un expediente mínimo. La venta o producto se registra después en el
                    flujo de Ventas.
                  </small>
                  <button className="primary-button" type="submit">
                    Registrar y agregar
                  </button>
                </form>
              ) : canAddExisting ? (
                <form action={bookStudentFromToday} className="today-walkin-form">
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
                  <select name="student_id" defaultValue="" required>
                    <option value="" disabled>
                      Selecciona una alumna
                    </option>
                    {candidates.map((candidate) => {
                      const canFallbackToWalkin = walkinFallbackDetails.has(candidate.detail);
                      return (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                          disabled={!candidate.eligible && !canFallbackToWalkin}
                        >
                          {candidate.fullName} · {candidate.detail}
                          {candidate.eligible
                            ? ""
                            : canFallbackToWalkin
                              ? " · walk-in / venta pendiente"
                              : " · bloqueada"}
                        </option>
                      );
                    })}
                  </select>
                  <button className="primary-button" type="submit" disabled={!candidates.length}>
                    Agregar a la clase
                  </button>
                  <small>
                    El fallback walk-in sólo aplica cuando falta paquete, cobertura o créditos. Si
                    existe otro requisito obligatorio, debe resolverse antes de reservar.
                  </small>
                </form>
              ) : null}
            </section>
          ) : null}

          {canAttendance ? (
            <section className="today-walkin">
              <div className="today-drawer-heading">
                <div>
                  <strong>{isCompleted ? "Asistencia finalizada" : "Resumen"}</strong>
                  <span>
                    {attendanceCount} asistieron · {noShowCount} no-show · {pendingCount}{" "}
                    pendientes.
                    {isCompleted
                      ? " Cualquier cambio posterior es una Corrección y exige motivo."
                      : " Al finalizar, los pendientes se registran como no-show y se resuelven los créditos."}
                  </span>
                </div>
              </div>
              {!isCompleted ? (
                <form action={finalizeAttendanceFromToday}>
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
                  <button className="primary-button" type="submit">
                    Finalizar asistencia
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
