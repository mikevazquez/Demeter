"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useUndoableOperations } from "./UndoableOperations";
import { useRouter } from "next/navigation";
import { markAllAttended, undoMarkAll } from "./search-actions";
import {
  finalizeAttendanceFromToday,
  cancelReservationFromToday,
  createWalkinFromToday,
  setAttendanceFromToday,
} from "../actions";
import { startScheduledEvaluationAction } from "../alumnas/[studentId]/evaluation-actions";
import { ExistingStudentAddForm } from "./ExistingStudentAddForm";
import { PendingClassPaymentDialog } from "./PendingClassPaymentDialog";

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
  paymentDueOnAttendance?: boolean;
  pendingPackageSaleId?: string;
  pendingPackageAmountMinor?: number;
  individualPriceMinor?: number | null;
  currency?: string;
  resourceName?: string | null;
  resourceRequired?: boolean;
};

type SessionOperationsProps = {
  sessionId: string;
  returnDate: string;
  sessionStatus: string;
  startsAt: string;
  endsAt: string;
  roster: RosterItem[];
  available: number;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
  canCollectPayment?: boolean;
  operatingPolicy?: {
    noShowConsumesCredit: boolean;
    cancellationCutoffMinutes: number;
    lateCancellationConsumesCredit: boolean;
  };
  locale: string;
  timeZone: string;
  canCorrectCompleted?: boolean;
  returnTo?: string;
  initiallyOpen?: boolean;
  showToggle?: boolean;
};

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

export function SessionOperations({
  sessionId,
  returnDate,
  sessionStatus,
  startsAt,
  endsAt,
  roster,
  available,
  canAttendance,
  canBook,
  canCreateStudent,
  canCollectPayment = true,
  operatingPolicy,
  locale,
  timeZone,
  canCorrectCompleted = true,
  returnTo = "",
  initiallyOpen = false,
  showToggle = true,
}: SessionOperationsProps) {
  const queue = useUndoableOperations();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [batch, setBatch] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [open, setOpen] = useState(initiallyOpen);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newWalkin, setNewWalkin] = useState(false);
  const [paymentItem, setPaymentItem] = useState<RosterItem | null>(null);
  const [cancelItem, setCancelItem] = useState<RosterItem | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const isCompleted = sessionStatus === "completed";
  const isCancelled = sessionStatus === "cancelled";
  const startsAtMs = new Date(startsAt).getTime();
  const endsAtMs = new Date(endsAt).getTime();
  const inProgress =
    sessionStatus === "scheduled" && now !== null && now >= startsAtMs - 20 * 60000;
  // Closing consolidates the session; it does not lock studio operations.
  const canPostCloseAdd = isCompleted && canBook && canCorrectCompleted && canAttendance;
  const canAddExisting = !isCancelled && (canBook || canPostCloseAdd);
  const canAddNew = !isCancelled && canCreateStudent && canAttendance;
  const canAddWalkin = canAddExisting || canAddNew;
  const showNewWalkin = canAddNew && (newWalkin || !canAddExisting);

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
      if (canBook && params.get("add") === sessionId) setShowAddStudent(true);

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
                    : created === "paid-attendance"
                      ? "Pago y asistencia registrados correctamente."
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
            error === "cancel_reason_required"
              ? "Selecciona un motivo para cancelar la reserva."
              : error === "correction_reason_required"
                ? "La corrección requiere un motivo."
                : error === "attendance_not_persisted"
                  ? "La corrección no se guardó. Intenta nuevamente."
                  : error === "attendance_payment_not_persisted"
                    ? "El pago o la asistencia no se guardaron. Intenta nuevamente."
                    : error === "asistian_payment_required"
                      ? "Esta reserva tiene pago pendiente. Registra el cobro antes de marcar asistencia."
                      : error === "class_price_required"
                        ? "Esta actividad no tiene precio individual configurado. Ingresa el monto cobrado."
                        : error === "payment_method_required"
                          ? "Selecciona cómo se pagó la clase."
                          : error === "payment_not_pending"
                            ? "Esta reserva ya no tiene un pago pendiente."
                            : error === "reservation_not_asistian"
                              ? "Esta reserva no corresponde al flujo de pago pendiente."
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
  }, [sessionId, showToggle, canBook]);

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
          {open ? "Ocultar" : `Alumnas · ${roster.length}`}
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
                <h3>Alumnas</h3>
                <span>
                  {roster.length} {roster.length === 1 ? "alumna" : "alumnas"}
                </span>
              </div>

              {canAddWalkin ? (
                <button
                  className="today-add-student-button is-labeled"
                  type="button"
                  onClick={() => setShowAddStudent((value) => !value)}
                  aria-expanded={showAddStudent}
                  aria-label={showAddStudent ? "Cerrar agregar alumna" : "Agregar alumna"}
                  title="Agregar alumna"
                >
                  {showAddStudent ? "Cerrar" : "+ Agregar alumna"}
                </button>
              ) : null}
            </div>

            {showAddStudent ? (
              <div className="today-add-panel">
                <div className="today-add-panel-heading">
                  <span>
                    <strong>Agregar alumna</strong>
                    <small>Busca primero. Si no existe, créala aquí mismo.</small>
                  </span>
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
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      queue({
                        key: `walkin:${sessionId}:${data.get("phone")}`,
                        label: "Agregar visita al estudio",
                        action: createWalkinFromToday,
                        data,
                      });
                    }}
                    action={createWalkinFromToday}
                    className="today-add-form"
                  >
                    <input type="hidden" name="session_id" value={sessionId} />
                    <input type="hidden" name="return_date" value={returnDate} />
                    {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
                    <input name="first_name" placeholder="Nombre" required />
                    <input name="last_name" placeholder="Apellido" />
                    <input name="phone" type="tel" placeholder="Teléfono · 10 dígitos" required />
                    <label>
                      Tipo de clase
                      <select name="class_kind">
                        <option value="trial">Clase de prueba · $150</option>
                        <option value="drop_in">Clase suelta</option>
                      </select>
                    </label>
                    <label>
                      Pago
                      <select name="payment_method">
                        <option value="pay_later">Paga después</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="tarjeta">Tarjeta</option>
                      </select>
                    </label>
                    <button className="primary-button" type="submit">
                      Registrar y agregar
                    </button>
                  </form>
                ) : canAddExisting ? (
                  <ExistingStudentAddForm
                    sessionId={sessionId}
                    returnDate={returnDate}
                    returnTo={returnTo}
                  />
                ) : null}
              </div>
            ) : null}

            {isCompleted ? (
              <p className="flow-operation-note">
                Lista cerrada. Para cambiar una asistencia usa “Corregir”; se pedirá el motivo.
              </p>
            ) : !inProgress && !isCancelled ? (
              <p className="flow-operation-note">
                Podrás pasar asistencia desde 20 minutos antes de la clase.
              </p>
            ) : null}
            {inProgress &&
            canAttendance &&
            roster.some((item) => item.status === "reserved" && !item.paymentDueOnAttendance) ? (
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await markAllAttended(sessionId);
                    if (result.ok && "batch_id" in result) {
                      setBatch(result.batch_id);
                      setFeedback({
                        kind: "success",
                        message: `${result.count} marcadas como asistió`,
                      });
                      window.setTimeout(() => setBatch(null), 5000);
                      router.refresh();
                    } else
                      setFeedback({ kind: "error", message: "No pudimos marcar la asistencia." });
                  })
                }
              >
                Marcar a todas como asistió
              </button>
            ) : null}
            {batch ? (
              <button
                type="button"
                className="flow-back"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await undoMarkAll(batch);
                    setBatch(null);
                    setFeedback({
                      kind: result.ok ? "success" : "error",
                      message: result.ok
                        ? "Asistencia restaurada"
                        : "Ya no se puede deshacer. Revisa la lista.",
                    });
                    router.refresh();
                  })
                }
              >
                Deshacer
              </button>
            ) : null}
            {sessionStatus === "scheduled" && now !== null && now >= endsAtMs && canAttendance ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => setConfirmClose(true)}
              >
                Cerrar lista
              </button>
            ) : null}
            {confirmClose ? (
              <div className="flow-card">
                <h3>Cerrar lista</h3>
                <p>
                  {roster.some((item) => item.status === "reserved")
                    ? `Quedan ${roster.filter((item) => item.status === "reserved").length} sin marcar: ${roster
                        .filter((item) => item.status === "reserved")
                        .map((item) => item.studentName)
                        .join(", ")}. Al cerrar se registrarán como no asistió.`
                    : "Todas las asistencias están registradas."}
                </p>
                <p>
                  {operatingPolicy
                    ? operatingPolicy.noShowConsumesCredit
                      ? "Según la política del estudio, las inasistencias consumen el crédito reservado."
                      : "Según la política del estudio, las inasistencias devuelven el crédito reservado."
                    : "Se aplicará la política de inasistencias del estudio."}
                </p>
                <form action={finalizeAttendanceFromToday}>
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="return_date" value={returnDate} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className="primary-button">Cerrar lista</button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setConfirmClose(false)}
                  >
                    Volver
                  </button>
                </form>
              </div>
            ) : null}
            {roster.length ? (
              <div className="today-student-list compact">
                {roster.map((item) => {
                  const canCorrect =
                    isCompleted &&
                    canCorrectCompleted &&
                    canAttendance &&
                    ["attended", "no_show", "reserved"].includes(item.status);

                  const isInvitation = item.packageLabel === "Invitación";

                  return (
                    <article className="today-student-card compact" key={item.id}>
                      <div className="today-student-avatar" aria-hidden="true">
                        {initials(item.studentName)}
                      </div>

                      <div className="today-student-identity">
                        <div className="today-student-name-line">
                          {canBook && item.studentId ? (
                            <Link href={`/admin/alumnas/${item.studentId}`}>
                              {item.studentName}
                            </Link>
                          ) : (
                            <strong>{item.studentName}</strong>
                          )}
                          {isInvitation ? (
                            <span className="today-invite-tag">Invitación</span>
                          ) : null}
                          {item.paymentDueOnAttendance ? (
                            <span className="today-payment-pending-tag">Pago pendiente</span>
                          ) : null}
                          {item.pendingPackageSaleId ? (
                            <a
                              className="today-payment-pending-tag"
                              href={`/admin/ventas/${item.pendingPackageSaleId}`}
                            >
                              Efectivo pendiente ·{" "}
                              {new Intl.NumberFormat("es-MX", {
                                style: "currency",
                                currency: item.currency ?? "MXN",
                              }).format((item.pendingPackageAmountMinor ?? 0) / 100)}
                            </a>
                          ) : null}
                          {item.evaluationStatus === "scheduled" ? (
                            <span className="today-evaluation-tag">Evaluación programada</span>
                          ) : item.evaluationStatus === "in_progress" ? (
                            <span className="today-evaluation-tag is-active">
                              Evaluación en curso
                            </span>
                          ) : null}
                          {item.resourceRequired ? (
                            <span
                              className={`today-resource-tag${item.resourceName ? "" : " is-missing"}`}
                            >
                              {item.resourceName
                                ? `Recurso · ${item.resourceName}`
                                : "Sin recurso asignado"}
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
                                ? ` · ${new Intl.DateTimeFormat(locale, {
                                    timeZone,
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
                          {item.paymentDueOnAttendance && item.status !== "attended" ? (
                            <button
                              disabled={!canCollectPayment}
                              title={
                                canCollectPayment
                                  ? undefined
                                  : "Solicita apoyo a recepción para cobrar"
                              }
                              type="button"
                              className="today-payment-attendance-trigger"
                              onClick={() => setPaymentItem(item)}
                              aria-haspopup="dialog"
                            >
                              Asistió
                            </button>
                          ) : (
                            <form action={setAttendanceFromToday}>
                              <input type="hidden" name="session_id" value={sessionId} />
                              <input type="hidden" name="reservation_id" value={item.id} />
                              <input type="hidden" name="return_date" value={returnDate} />
                              {returnTo ? (
                                <input type="hidden" name="return_to" value={returnTo} />
                              ) : null}
                              <input
                                type="hidden"
                                name="status"
                                value={item.status === "attended" ? "reserved" : "attended"}
                              />
                              <button
                                className={
                                  item.status === "attended" ? "is-selected is-attended" : ""
                                }
                                type="submit"
                                aria-pressed={item.status === "attended"}
                              >
                                {item.status === "attended" ? "✓ " : ""}
                                Asistió
                              </button>
                            </form>
                          )}

                          <form action={setAttendanceFromToday}>
                            <input type="hidden" name="session_id" value={sessionId} />
                            <input type="hidden" name="reservation_id" value={item.id} />
                            <input type="hidden" name="return_date" value={returnDate} />
                            {returnTo ? (
                              <input type="hidden" name="return_to" value={returnTo} />
                            ) : null}
                            <input
                              type="hidden"
                              name="status"
                              value={item.status === "no_show" ? "reserved" : "no_show"}
                            />
                            <button
                              className={item.status === "no_show" ? "is-selected is-no-show" : ""}
                              type="submit"
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
                            <button type="button" onClick={() => setCancelItem(item)}>
                              Cancelar reserva
                            </button>
                          </div>
                        </details>
                      ) : (
                        <span className="today-student-more-placeholder" aria-hidden="true" />
                      )}

                      {canCorrect ? (
                        <details className="today-correction-details">
                          <summary>Corregir</summary>
                          <form action={setAttendanceFromToday} className="today-correction-form">
                            <input type="hidden" name="session_id" value={sessionId} />
                            <input type="hidden" name="reservation_id" value={item.id} />
                            <input type="hidden" name="return_date" value={returnDate} />
                            {returnTo ? (
                              <input type="hidden" name="return_to" value={returnTo} />
                            ) : null}
                            <label>
                              Asistencia
                              <select
                                name="status"
                                defaultValue={item.status === "attended" ? "no_show" : "attended"}
                              >
                                <option value="attended">Asistió</option>
                                <option value="no_show">No asistió</option>
                                <option value="reserved">Sin marcar</option>
                              </select>
                            </label>
                            <input
                              name="reason"
                              placeholder="Motivo de la corrección"
                              required
                              aria-label="Motivo de la corrección"
                            />
                            <button className="secondary-button" type="submit">
                              Guardar corrección
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="today-drawer-empty">Todavía no hay alumnas en esta clase.</div>
            )}
          </section>
        </div>
      ) : null}

      {cancelItem ? (
        <div
          className="today-payment-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCancelItem(null);
          }}
        >
          <section
            className="today-payment-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-reservation-title"
          >
            <header>
              <div>
                <span className="today-payment-eyebrow">CANCELAR RESERVA</span>
                <h3 id="cancel-reservation-title">Cancelar a {cancelItem.studentName}</h3>
                <p>Selecciona el motivo para registrar la cancelación.</p>
              </div>
              <button
                type="button"
                className="today-payment-close"
                onClick={() => setCancelItem(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>

            <form
              action={cancelReservationFromToday}
              onSubmit={(event) => {
                event.preventDefault();
                queue({
                  key: `cancel:${cancelItem.id}`,
                  label: `Cancelar reserva de ${cancelItem.studentName}`,
                  action: cancelReservationFromToday,
                  data: new FormData(event.currentTarget),
                });
                setCancelItem(null);
              }}
            >
              <input type="hidden" name="session_id" value={sessionId} />
              <input type="hidden" name="reservation_id" value={cancelItem.id} />
              <input type="hidden" name="return_date" value={returnDate} />
              {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

              <p>
                {operatingPolicy
                  ? `El límite para cancelar es ${operatingPolicy.cancellationCutoffMinutes} minutos antes. ${now !== null && now > startsAtMs - operatingPolicy.cancellationCutoffMinutes * 60_000 && operatingPolicy.lateCancellationConsumesCredit ? "Esta cancelación conservará el consumo del crédito según la política del estudio." : "Esta cancelación devolverá el crédito reservado."}`
                  : "Se aplicará la política de cancelación del estudio."}
              </p>
              <label className="today-payment-field">
                <span>Motivo de cancelación</span>
                <select name="reason" required defaultValue="">
                  <option value="" disabled>
                    Selecciona un motivo
                  </option>
                  <option value="schedule_conflict">Cambio de horario</option>
                  <option value="health">Salud</option>
                  <option value="work_school">Trabajo o estudios</option>
                  <option value="transport">Transporte</option>
                  <option value="price">Precio</option>
                  <option value="lost_interest">Ya no le interesa</option>
                  <option value="booking_error">Reserva por error</option>
                  <option value="other">Otro</option>
                  <option value="prefer_not_say">Prefiere no decirlo</option>
                </select>
              </label>

              <div className="today-payment-actions">
                <button
                  type="button"
                  className="today-payment-cancel"
                  onClick={() => setCancelItem(null)}
                >
                  Volver
                </button>
                <button type="submit" className="today-payment-confirm">
                  Confirmar cancelación
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {paymentItem ? (
        <PendingClassPaymentDialog
          reservationId={paymentItem.id}
          sessionId={sessionId}
          returnDate={returnDate}
          returnTo={returnTo}
          studentName={paymentItem.studentName}
          amountMinor={paymentItem.individualPriceMinor ?? null}
          currency={paymentItem.currency ?? "MXN"}
          onClose={() => setPaymentItem(null)}
        />
      ) : null}
    </div>
  );
}
