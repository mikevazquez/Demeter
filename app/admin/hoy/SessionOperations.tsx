"use client";

import { useEffect, useMemo, useState } from "react";

import {
  bookStudentFromToday,
  cancelReservationFromToday,
  createWalkinFromToday,
  setAttendanceFromToday,
} from "../actions";
import { startScheduledEvaluationAction } from "../alumnas/[studentId]/evaluation-actions";

type RosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
  studentId?: string | null;
  evaluationInvitationId?: string | null;
  evaluationStatus?: string | null;
  attendanceSource?: string | null;
  checkedInAt?: string | null;
  attendanceProvenance?: string | null;
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
  startsAt: string;
  endsAt: string;
  roster: RosterItem[];
  candidates: Candidate[];
  available: number;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
  canCorrectCompleted?: boolean;
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
  if (status === "no_show") return "No asistió";
  return "Pendiente";
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

export function SessionOperations({
  sessionId,
  returnDate,
  sessionStatus,
  startsAt,
  endsAt,
  roster,
  candidates,
  available,
  canAttendance,
  canBook,
  canCreateStudent,
  canCorrectCompleted = true,
  returnTo = "",
  initiallyOpen = false,
  showToggle = true,
}: SessionOperationsProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newWalkin, setNewWalkin] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const isCompleted = sessionStatus === "completed";
  const isCancelled = sessionStatus === "cancelled";
  const attendanceCount = roster.filter((item) => item.status === "attended").length;
  const noShowCount = roster.filter((item) => item.status === "no_show").length;
  const pendingCount = roster.filter((item) => item.status === "reserved").length;
  const startsAtMs = new Date(startsAt).getTime();
  const endsAtMs = new Date(endsAt).getTime();
  const inProgress =
    sessionStatus === "scheduled" && now !== null && now >= startsAtMs && now < endsAtMs;
  const sessionOpen = sessionStatus === "scheduled";
  const canPostCloseAdd = isCompleted && canCorrectCompleted && canAttendance;
  const canAddExisting = (sessionOpen && canBook) || canPostCloseAdd;
  const canAddNew = sessionOpen && canCreateStudent;
  const canAddWalkin = canAddExisting || canAddNew;
  const showNewWalkin = canAddNew && (newWalkin || !canAddExisting);
  const normalizedStudentSearch = normalizeSearch(studentSearch);
  const matchingCandidates = useMemo(() => {
    if (!normalizedStudentSearch) return [];
    return candidates
      .filter((candidate) =>
        normalizeSearch(candidate.fullName).includes(normalizedStudentSearch),
      )
      .slice(0, 8);
  }, [candidates, normalizedStudentSearch]);
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedStudentId);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
                  ? "Corrección registrada correctamente."
                  : created === "post-close-attendee"
                    ? "Asistencia agregada después del cierre."
                    : created === "walkin"
                      ? "Walk-in registrada y agregada a la clase."
                    : created === "walkin-existing"
                      ? "Alumna agregada a la clase."
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
              : error === "attendance_not_persisted"
                ? "La corrección no se guardó. Intenta nuevamente."
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
            <div className="today-roster-header compact">
              <div>
                <h3>Asistencia</h3>
                <span>
                  {roster.length} {roster.length === 1 ? "alumna" : "alumnas"}
                </span>
              </div>

              {canAddWalkin ? (
                <button
                  className="today-add-student-button"
                  type="button"
                  onClick={() => setShowAddStudent((value) => !value)}
                  aria-expanded={showAddStudent}
                  aria-label={showAddStudent ? "Cerrar agregar alumna" : "Agregar alumna"}
                  title="Agregar alumna"
                >
                  {showAddStudent ? "×" : "+"}
                </button>
              ) : null}
            </div>

            {roster.length ? (
              <div className="today-student-list compact">
                {roster.map((item) => {
                  const canCorrect =
                    isCompleted &&
                    canCorrectCompleted &&
                    canAttendance &&
                    ["attended", "no_show"].includes(item.status);
                  const correctionTarget = item.status === "attended" ? "no_show" : "attended";
                  const isInvitation = item.packageLabel === "Invitación";

                  return (
                    <article className="today-student-card compact" key={item.id}>
                      <div className="today-student-avatar" aria-hidden="true">
                        {initials(item.studentName)}
                      </div>

                      <div className="today-student-identity">
                        <div className="today-student-name-line">
                          <strong>{item.studentName}</strong>
                          {isInvitation ? (
                            <span className="today-invite-tag">Invitación</span>
                          ) : null}
                          {item.evaluationStatus === "scheduled" ? (
                            <span className="today-evaluation-tag">Evaluación programada</span>
                          ) : item.evaluationStatus === "in_progress" ? (
                            <span className="today-evaluation-tag is-active">
                              Evaluación en curso
                            </span>
                          ) : null}
                        </div>
                        <span>
                          {isInvitation
                            ? item.creditsLabel
                            : `${item.packageLabel} · ${item.creditsLabel}`}
                        </span>
                        {item.status === "attended" ? (
                          <>
                            <span className="today-attendance-origin">
                              {item.attendanceSource === "KIOSK" ? "Check-in" : "Manual"}
                              {item.checkedInAt
                                ? ` · ${new Intl.DateTimeFormat("es-MX", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }).format(new Date(item.checkedInAt))}`
                                : ""}
                            </span>
                            {item.attendanceProvenance ? (
                              <span className="today-attendance-origin">
                                {item.attendanceProvenance}
                              </span>
                            ) : null}
                          </>
                        ) : null}
                        {item.evaluationStatus === "scheduled" &&
                        item.evaluationInvitationId &&
                        item.studentId ? (
                          <form
                            action={startScheduledEvaluationAction}
                            className="today-evaluation-start-form"
                          >
                            <input type="hidden" name="student_id" value={item.studentId} />
                            <input
                              type="hidden"
                              name="invitation_id"
                              value={item.evaluationInvitationId}
                            />
                            <button type="submit">Iniciar evaluación →</button>
                          </form>
                        ) : null}
                      </div>

                      {inProgress &&
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
                              {item.status === "attended" ? "✓ " : ""}
                              Asistió
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
                              No asistió
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span
                          className={`today-attendance-state${item.status === "attended" ? " is-attended" : ""}${item.status === "no_show" ? " is-no-show" : ""}`}
                        >
                          {attendanceLabel(item.status)}
                        </span>
                      )}

                      {!isCompleted && !isCancelled && canBook && item.status === "reserved" ? (
                        <details className="today-student-more">
                          <summary aria-label={`Más acciones para ${item.studentName}`}>⋮</summary>
                          <div>
                            <form action={cancelReservationFromToday}>
                              <input type="hidden" name="session_id" value={sessionId} />
                              <input type="hidden" name="reservation_id" value={item.id} />
                              <input type="hidden" name="return_date" value={returnDate} />
                              {returnTo ? (
                                <input type="hidden" name="return_to" value={returnTo} />
                              ) : null}
                              <button type="submit">Cancelar reserva</button>
                            </form>
                          </div>
                        </details>
                      ) : (
                        <span className="today-student-more-placeholder" aria-hidden="true" />
                      )}

                      {canCorrect ? (
                        <form action={setAttendanceFromToday} className="today-correction-form">
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
                            Corregir a {correctionTarget === "attended" ? "Asistió" : "No asistió"}
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="today-drawer-empty">Todavía no hay alumnas en esta clase.</div>
            )}

            {showAddStudent ? (
              <div className="today-add-panel">
                <div className="today-add-panel-heading">
                  <strong>Agregar alumna</strong>
                  {canAddExisting && canAddNew ? (
                    <button
                      type="button"
                      onClick={() => setNewWalkin((value) => !value)}
                      className="today-add-mode"
                    >
                      {showNewWalkin ? "Buscar existente" : "Nueva alumna"}
                    </button>
                  ) : null}
                </div>

                {available <= 0 ? (
                  <div className="today-drawer-empty">La clase ya está llena.</div>
                ) : showNewWalkin ? (
                  <form action={createWalkinFromToday} className="today-add-form">
                    <input type="hidden" name="session_id" value={sessionId} />
                    <input type="hidden" name="return_date" value={returnDate} />
                    {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
                    <input name="first_name" placeholder="Nombre" required />
                    <input name="last_name" placeholder="Apellido" />
                    <input name="phone" type="tel" placeholder="Teléfono" required />
                    <button className="primary-button" type="submit">
                      Registrar y agregar
                    </button>
                  </form>
                ) : canAddExisting ? (
                  <form action={bookStudentFromToday} className="today-add-form is-existing">
                    <input type="hidden" name="session_id" value={sessionId} />
                    <input type="hidden" name="return_date" value={returnDate} />
                    <input type="hidden" name="student_id" value={selectedStudentId} />
                    {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

                    <div className="today-student-search">
                      <input
                        type="search"
                        value={studentSearch}
                        onChange={(event) => {
                          setStudentSearch(event.target.value);
                          setSelectedStudentId("");
                        }}
                        placeholder="Buscar alumna por nombre"
                        aria-label="Buscar alumna por nombre"
                        autoComplete="off"
                      />

                      {normalizedStudentSearch ? (
                        <div className="today-student-search-results" role="listbox">
                          {matchingCandidates.length ? (
                            matchingCandidates.map((candidate) => {
                              const canFallbackToWalkin = walkinFallbackDetails.has(
                                candidate.detail,
                              );
                              const disabled =
                                !canPostCloseAdd && !candidate.eligible && !canFallbackToWalkin;
                              const selected = candidate.id === selectedStudentId;

                              return (
                                <button
                                  key={candidate.id}
                                  type="button"
                                  className={`today-student-search-result${selected ? " is-selected" : ""}`}
                                  onClick={() => {
                                    if (disabled) return;
                                    setSelectedStudentId(candidate.id);
                                    setStudentSearch(candidate.fullName);
                                  }}
                                  disabled={disabled}
                                  role="option"
                                  aria-selected={selected}
                                >
                                  <span>{candidate.fullName}</span>
                                  <small>
                                    {canPostCloseAdd
                                      ? "Agregar después del cierre"
                                      : candidate.detail}
                                  </small>
                                </button>
                              );
                            })
                          ) : (
                            <div className="today-student-search-empty">
                              No encontramos alumnas con ese nombre.
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="today-student-search-hint">
                          Escribe el nombre para ver coincidencias.
                        </p>
                      )}
                    </div>

                    {selectedCandidate ? (
                      <div className="today-student-search-selected">
                        <span>Seleccionada</span>
                        <strong>{selectedCandidate.fullName}</strong>
                      </div>
                    ) : null}

                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!selectedStudentId}
                    >
                      Agregar
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </section>

          {canAttendance ? (
            <section className="today-attendance-footer">
              <div className="today-attendance-summary">
                <span>{attendanceCount} asistieron</span>
                <span>{noShowCount} no asistieron</span>
                <span>{pendingCount} pendientes</span>
              </div>

              {isCompleted ? (
                <p>
                  {canCorrectCompleted
                    ? "Asistencia finalizada. Las correcciones requieren motivo."
                    : "Clase finalizada · asistencia en modo solo lectura."}
                </p>
              ) : isCancelled ? (
                <p>Clase cancelada · sin acciones operativas.</p>
              ) : inProgress ? (
                <p>Clase en curso · el cierre de asistencia es automático.</p>
              ) : now !== null && now < startsAtMs ? (
                <p>La asistencia manual se habilita cuando inicia la clase.</p>
              ) : (
                <p>Cerrando asistencia automáticamente…</p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
