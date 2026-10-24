"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import { calculateDeposit, quoteWorkshopPurchase } from "@/src/lib/workshops/purchase-quote";
import { receivedAmountMinor, type WorkshopAdminContext } from "@/src/lib/workshops/admin";
import { workshopBalanceDueAt } from "@/src/lib/workshops/first-session-policy";
import { purchaseWorkshop } from "../actions";
import { WorkshopPaymentMethodFields } from "@/components/WorkshopPaymentMethodFields";

function normalizeStudentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

export function WorkshopPurchaseForm({
  context,
  locale,
  currency,
  timeZone,
  requestId,
  canPurchase,
}: {
  context: WorkshopAdminContext;
  locale: string;
  currency: string;
  timeZone: string;
  requestId: string;
  canPurchase: boolean;
}) {
  const [state, action, pending] = useActionState(purchaseWorkshop, { error: null });
  const [mode, setMode] = useState<"full" | "sessions">("full");
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState<string | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<"deposit" | "custom" | "full">("deposit");
  const [studentId, setStudentId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentSearchOpen, setStudentSearchOpen] = useState(false);
  const [studentSearchIndex, setStudentSearchIndex] = useState(0);
  const studentSearchInputId = useId();
  const studentSearchListboxId = `${studentSearchInputId}-matches`;
  const [purchaseRequestId] = useState(requestId);
  const [receivedChecked, setReceivedChecked] = useState(false);
  const offer = context.offer;
  const quote = quoteWorkshopPurchase(
    {
      workshopId: offer.id,
      fullPriceMinor: offer.fullPriceMinor,
      allowIndividualSessions: offer.allowIndividualSessions,
      sessions: context.sessions,
    },
    mode === "full" ? { mode } : { mode, sessionIds: selected },
  );
  const dueAt = quote.ok
    ? workshopBalanceDueAt(
        context.sessions
          .filter((session) => quote.sessionIds.includes(session.id))
          .map((session) => session.startsAt),
      )
    : null;
  let minimum: number | null = null;
  if (quote.ok) {
    try {
      minimum = calculateDeposit(
        quote.totalMinor,
        offer.depositMode === "full"
          ? { mode: "full" }
          : offer.depositMode === "fixed"
            ? { mode: "fixed", amountMinor: Math.min(quote.totalMinor, Number(offer.depositValue)) }
            : { mode: "percent", percent: Number(offer.depositValue) },
      ).dueNowMinor;
    } catch {
      /* Invalid configuration keeps checkout disabled. */
    }
  }
  const suggestedReceived =
    quote.ok && minimum != null ? (paymentChoice === "full" ? quote.totalMinor : minimum) : null;
  const displayAmount =
    amount === null && suggestedReceived != null ? String(suggestedReceived / 100) : (amount ?? "");
  const effectiveReceived = receivedAmountMinor(displayAmount);
  const amountValid =
    quote.ok &&
    minimum != null &&
    effectiveReceived != null &&
    effectiveReceived >= minimum &&
    effectiveReceived <= quote.totalMinor &&
    (effectiveReceived === quote.totalMinor || dueAt != null);
  const money = (minor: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
      new Date(value),
    );
  const studentMatches = useMemo(() => {
    const normalizedQuery = normalizeStudentSearch(studentQuery);
    if (normalizedQuery.length < 2) return [];

    return context.students
      .map((student) => ({
        ...student,
        normalizedName: normalizeStudentSearch(student.name),
      }))
      .filter((student) => student.normalizedName.includes(normalizedQuery))
      .sort((a, b) => {
        const aStarts = a.normalizedName.startsWith(normalizedQuery);
        const bStarts = b.normalizedName.startsWith(normalizedQuery);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name, "es-MX");
      })
      .slice(0, 8);
  }, [context.students, studentQuery]);

  const selectedStudent = context.students.find((student) => student.id === studentId) ?? null;

  const chooseStudent = (student: { id: string; name: string }) => {
    setStudentId(student.id);
    setStudentQuery(student.name);
    setStudentSearchOpen(false);
    setStudentSearchIndex(0);
  };

  const updateStudentQuery = (value: string) => {
    setStudentQuery(value);
    setStudentId("");
    setStudentSearchIndex(0);
    setStudentSearchOpen(normalizeStudentSearch(value).length >= 2);
  };

  const unavailable =
    !canPurchase ||
    currency !== "MXN" ||
    !context.students.length ||
    !context.paymentMethods.length;

  if (state.receipt)
    return (
      <section className="activities-stage" role="status">
        <h2>Compra confirmada</h2>
        <p>
          El pago de {money(state.receipt.paidMinor)} quedó registrado y las fechas están
          reservadas.
        </p>
        <p>Saldo pendiente: {money(state.receipt.totalMinor - state.receipt.paidMinor)}.</p>
        <Link href={`/admin/ventas/${state.receipt.saleId}`}>Ver venta</Link>
        <Link href="/admin/actividades/talleres">Volver a talleres</Link>
      </section>
    );

  return (
    <form action={action} onReset={(event) => event.preventDefault()} className="activities-stage">
      <h2>Registrar compra y reservar</h2>
      <p>
        Registra únicamente dinero recibido y verificado. Para transferencias, captura la referencia
        bancaria.
      </p>
      {!canPurchase ? (
        <p>
          Necesitas permisos de ventas, reservas y consulta de alumnas para registrar una compra.
        </p>
      ) : null}
      {offer.requiresEnrollment ? (
        <p role="alert">
          Este taller requiere una inscripción vigente en las fechas elegidas. Se comprobará antes
          de registrar el pago y las reservas.
        </p>
      ) : null}
      {!context.students.length && canPurchase ? (
        <p>No hay alumnas activas disponibles para reservar.</p>
      ) : null}
      {!context.paymentMethods.length ? (
        <p>No hay métodos de pago habilitados para este taller.</p>
      ) : null}
      {currency !== "MXN" ? <p>Este registro de pagos solo admite pesos mexicanos.</p> : null}
      <fieldset className="workshop-purchase-fields" disabled={pending || unavailable}>
        <input type="hidden" name="offer_id" value={offer.id} />
        <input type="hidden" name="request_id" value={purchaseRequestId} />
        <input type="hidden" name="offer_revision" value={offer.revision} />
        {(quote.ok ? quote.sessionIds : []).map((id) => (
          <input type="hidden" name="session_ids" key={id} value={id} />
        ))}
        <div className="activities-field activities-student-search">
          <label htmlFor={studentSearchInputId}>Alumna</label>
          <input type="hidden" name="student_id" value={studentId} />
          <div className="activities-combobox">
            <input
              id={studentSearchInputId}
              type="search"
              value={studentQuery}
              placeholder="Escribe el nombre de la alumna"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls={studentSearchListboxId}
              aria-expanded={studentSearchOpen && normalizeStudentSearch(studentQuery).length >= 2}
              aria-activedescendant={
                studentSearchOpen && studentMatches[studentSearchIndex]
                  ? `${studentSearchListboxId}-option-${studentSearchIndex}`
                  : undefined
              }
              onChange={(event) => updateStudentQuery(event.target.value)}
              onFocus={() => {
                if (normalizeStudentSearch(studentQuery).length >= 2 && !selectedStudent) {
                  setStudentSearchOpen(true);
                }
              }}
              onBlur={() => setStudentSearchOpen(false)}
              onKeyDown={(event) => {
                if (!studentSearchOpen || studentMatches.length === 0) {
                  if (
                    event.key === "ArrowDown" &&
                    normalizeStudentSearch(studentQuery).length >= 2
                  ) {
                    setStudentSearchOpen(true);
                  }
                  return;
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setStudentSearchIndex((current) => (current + 1) % studentMatches.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setStudentSearchIndex(
                    (current) => (current - 1 + studentMatches.length) % studentMatches.length,
                  );
                } else if (event.key === "Enter" && studentMatches[studentSearchIndex]) {
                  event.preventDefault();
                  chooseStudent(studentMatches[studentSearchIndex]);
                } else if (event.key === "Escape") {
                  setStudentSearchOpen(false);
                }
              }}
            />
            {studentQuery ? (
              <button
                type="button"
                className="activities-combobox-clear"
                aria-label="Limpiar alumna"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setStudentQuery("");
                  setStudentId("");
                  setStudentSearchOpen(false);
                  setStudentSearchIndex(0);
                }}
              >
                ×
              </button>
            ) : null}
            {studentSearchOpen && normalizeStudentSearch(studentQuery).length >= 2 ? (
              <div
                id={studentSearchListboxId}
                role="listbox"
                className="activities-combobox-results"
              >
                {studentMatches.length ? (
                  studentMatches.map((student, index) => (
                    <button
                      key={student.id}
                      id={`${studentSearchListboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={studentId === student.id}
                      className={index === studentSearchIndex ? "is-active" : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setStudentSearchIndex(index)}
                      onClick={() => chooseStudent(student)}
                    >
                      <strong>{student.name}</strong>
                    </button>
                  ))
                ) : (
                  <p className="activities-combobox-empty">
                    No encontramos alumnas con ese nombre.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <small>
            {selectedStudent
              ? "Alumna seleccionada. Puedes borrar el nombre para cambiarla."
              : "Escribe al menos 2 letras y elige una coincidencia."}
          </small>
        </div>
        <fieldset className="activities-choice">
          <legend>Qué compra</legend>
          <label>
            <input
              type="radio"
              name="purchase_mode"
              value="full"
              checked={mode === "full"}
              onChange={() => setMode("full")}
            />{" "}
            Taller completo · {money(offer.fullPriceMinor)}
          </label>
          {offer.allowIndividualSessions ? (
            <label>
              <input
                type="radio"
                name="purchase_mode"
                value="sessions"
                checked={mode === "sessions"}
                onChange={() => setMode("sessions")}
              />{" "}
              Elegir fechas individuales
            </label>
          ) : null}
        </fieldset>
        <div className="program-dates-table-wrap">
          <table className="program-dates-table">
            <caption>Fechas y cupos del taller</caption>
            <thead>
              <tr>
                <th>Elegir</th>
                <th>Fecha</th>
                <th>Disponibles</th>
                <th>Precio individual</th>
              </tr>
            </thead>
            <tbody>
              {context.sessions.map((session) => (
                <tr key={session.id}>
                  <td data-label="Seleccionar">
                    <input
                      type="checkbox"
                      aria-label={`Elegir ${date(session.startsAt)}`}
                      checked={mode === "full" || selected.includes(session.id)}
                      disabled={
                        mode === "full" ||
                        session.capacityRemaining < 1 ||
                        session.priceMinor == null
                      }
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelected((previous) =>
                          checked
                            ? [...previous, session.id]
                            : previous.filter((id) => id !== session.id),
                        );
                      }}
                    />
                  </td>
                  <td data-label="Fecha">{date(session.startsAt)}</td>
                  <td data-label="Disponibles">{session.capacityRemaining}</td>
                  <td data-label="Individual">
                    {session.priceMinor == null ? "Solo completo" : money(session.priceMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {quote.ok && minimum != null ? (
          <div className="workshop-purchase-summary" aria-live="polite">
            <p>
              Total: <strong>{money(quote.totalMinor)}</strong>
            </p>
            <p>
              Anticipo mínimo: <strong>{money(minimum)}</strong>
            </p>
            {dueAt ? <p>Saldo completo al iniciar la primera fecha: {date(dueAt)}.</p> : null}
            {offer.overdueMode === "keep_and_notify" ? (
              <p>Si queda saldo vencido, se conservan las reservas y se avisa al estudio.</p>
            ) : (
              <p>
                Los lugares podrán liberarse si el saldo vence y transcurren {offer.graceMinutes}{" "}
                minutos de gracia.
              </p>
            )}
          </div>
        ) : (
          <p role="status">Elige fechas con cupo y precio disponible para calcular la compra.</p>
        )}
        {quote.ok && minimum != null && minimum < quote.totalMinor ? (
          <fieldset className="activities-choice">
            <legend>¿Cuánto pagó la alumna?</legend>
            <label>
              <input
                type="radio"
                name="payment_choice"
                checked={paymentChoice === "deposit"}
                onChange={() => {
                  setPaymentChoice("deposit");
                  setAmount(null);
                }}
              />{" "}
              Anticipo mínimo · {money(minimum)}
            </label>
            <label>
              <input
                type="radio"
                name="payment_choice"
                checked={paymentChoice === "custom"}
                onChange={() => {
                  setPaymentChoice("custom");
                  setAmount(null);
                }}
              />{" "}
              Otro importe (entre {money(minimum)} y {money(quote.totalMinor)})
            </label>
            <label>
              <input
                type="radio"
                name="payment_choice"
                checked={paymentChoice === "full"}
                onChange={() => {
                  setPaymentChoice("full");
                  setAmount(null);
                }}
              />{" "}
              Pago completo · {money(quote.totalMinor)}
            </label>
          </fieldset>
        ) : null}
        <div className="activities-form-grid">
          <label className="activities-field">
            <span>Importe realmente recibido (MXN) · editable</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              name="received_amount"
              required
              value={displayAmount}
              onChange={(event) => {
                setAmount(event.target.value);
                if (paymentChoice !== "custom") setPaymentChoice("custom");
              }}
            />
          </label>
          <WorkshopPaymentMethodFields
            methods={context.paymentMethods}
            initialMethod={context.paymentMethods[0] ?? ""}
            referenceName="reference"
            referenceMinLength={1}
            fieldClassName="activities-field"
            referenceClassName="activities-field activities-field-wide"
          />
        </div>
        {quote.ok && effectiveReceived != null && effectiveReceived <= quote.totalMinor ? (
          <p aria-live="polite">
            Saldo después del pago: <strong>{money(quote.totalMinor - effectiveReceived)}</strong>.
          </p>
        ) : null}
        {quote.ok && !amountValid ? (
          <p role="status">
            {effectiveReceived == null
              ? "Ingresa un importe válido."
              : effectiveReceived < (minimum ?? 0)
                ? "El importe es menor al anticipo mínimo."
                : effectiveReceived > quote.totalMinor
                  ? "El importe supera el total del taller."
                  : "Para registrar un pago parcial, configura primero el vencimiento del saldo en el taller."}
          </p>
        ) : null}
        <label>
          <input
            type="checkbox"
            name="payment_received"
            required
            checked={receivedChecked}
            onChange={(event) => setReceivedChecked(event.target.checked)}
          />{" "}
          Ya recibí y verifiqué el dinero de este pago.
        </label>
        <p>El cupo y el importe se confirman al guardar.</p>
        <button
          className="activities-next-button"
          type="submit"
          disabled={pending || !amountValid || !studentId}
        >
          {pending ? "Registrando…" : "Registrar pago y reservar"}
        </button>
      </fieldset>
      {state.error ? (
        <p role="alert" className="activities-inline-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
