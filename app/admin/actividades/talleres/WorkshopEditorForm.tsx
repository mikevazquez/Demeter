"use client";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { receivedAmountMinor } from "@/src/lib/workshops/admin";
import type {
  WorkshopDraft,
  WorkshopEditorContext,
  WorkshopEditorDate,
} from "@/src/lib/workshops/editor";
import { saveWorkshop } from "./editor-actions";

type Row = Omit<WorkshopEditorDate, "priceMinor"> & { key: string; price: string };
const emptyRow = (key: string): Row => ({
  key,
  sessionId: "",
  date: "",
  time: "10:00",
  disciplineId: "",
  instructorId: "",
  spaceId: "",
  durationMinutes: 60,
  capacity: 10,
  price: "",
});
export function WorkshopEditorForm({
  context,
  offerId,
  requestId,
}: {
  context: WorkshopEditorContext;
  offerId?: string;
  requestId: string;
}) {
  const initial = context.draft;
  const [state, action, pending] = useActionState(saveWorkshop, { error: null });
  const [title, setTitle] = useState(initial?.title ?? "");
  const [step, setStep] = useState(0);
  const stages = ["Información", "Fechas", "Precios", "Pagos", "Revisión"];
  const [fullPrice, setFullPrice] = useState(initial ? String(initial.fullPriceMinor / 100) : "");
  const [allowIndividual, setAllowIndividual] = useState(initial?.allowIndividualSessions ?? false);
  const [enrollment, setEnrollment] = useState(
    initial?.requiresEnrollment == null
      ? "not_required"
      : initial.requiresEnrollment
        ? "required"
        : "not_required",
  );
  const [depositMode, setDepositMode] = useState<WorkshopDraft["depositMode"]>(
    initial?.depositMode ?? "full",
  );
  const [deposit, setDeposit] = useState(
    initial?.depositValue == null
      ? "50"
      : String(initial.depositMode === "fixed" ? initial.depositValue / 100 : initial.depositValue),
  );
  const [overdue, setOverdue] = useState(initial?.overdueMode ?? "inherit");
  const [grace, setGrace] = useState(String(initial?.graceMinutes ?? 0));
  const [rows, setRows] = useState<Row[]>(() =>
    initial?.dates.length
      ? initial.dates.map((row, index) => ({
          ...row,
          key: row.sessionId || `new-${index}`,
          price: row.priceMinor == null ? "" : String(row.priceMinor / 100),
        }))
      : [emptyRow("new-0")],
  );
  const due =
    rows
      .map((row) => (row.date && row.time ? `${row.date}T${row.time}` : ""))
      .filter(Boolean)
      .sort()[0] ?? "";
  const sequence = useRef(rows.length);
  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const currentStepValid = [
    Boolean(title.trim()),
    rows.every(
      (row) =>
        Boolean(row.date && row.time && row.disciplineId) &&
        row.durationMinutes >= 15 &&
        row.capacity >= 1,
    ),
    Boolean(receivedAmountMinor(fullPrice)) &&
      (!allowIndividual || rows.every((row) => Boolean(receivedAmountMinor(row.price)))),
    depositMode === "full" ||
      (Boolean(due) &&
        (depositMode === "fixed"
          ? Boolean(receivedAmountMinor(deposit))
          : Number(deposit) > 0 && Number(deposit) <= 100)),
    true,
  ];
  const invalidDraft =
    !title.trim() ||
    (!context.locked &&
      (!context.disciplines.length ||
        !receivedAmountMinor(fullPrice) ||
        rows.some(
          (row) =>
            !row.date ||
            !row.time ||
            !row.disciplineId ||
            (allowIndividual && !receivedAmountMinor(row.price)),
        ) ||
        (depositMode !== "full" &&
          (!due ||
            (depositMode === "fixed"
              ? !receivedAmountMinor(deposit)
              : !(Number(deposit) > 0 && Number(deposit) <= 100))))));
  const payload: WorkshopDraft | Pick<WorkshopDraft, "title"> = context.locked
    ? { title: title.trim() }
    : {
        title: title.trim(),
        fullPriceMinor: receivedAmountMinor(fullPrice) ?? 0,
        allowIndividualSessions: allowIndividual,
        requiresEnrollment: enrollment === "inherit" ? null : enrollment === "required",
        depositMode,
        depositValue:
          depositMode === "full"
            ? null
            : depositMode === "fixed"
              ? (receivedAmountMinor(deposit) ?? 0)
              : Number(deposit),
        balanceDueLocal: depositMode === "full" ? "" : due,
        overdueMode: overdue === "inherit" ? null : (overdue as WorkshopDraft["overdueMode"]),
        graceMinutes:
          overdue === "inherit" ? null : overdue === "keep_and_notify" ? 0 : Number(grace),
        dates: rows.map((row) => ({
          sessionId: row.sessionId,
          date: row.date,
          time: row.time,
          disciplineId: row.disciplineId,
          instructorId: row.instructorId,
          spaceId: row.spaceId,
          durationMinutes: row.durationMinutes,
          capacity: row.capacity,
          priceMinor: allowIndividual ? receivedAmountMinor(row.price) : null,
        })),
      };
  if (state.saved)
    return (
      <section className="activities-stage" role="status">
        <h2>Taller guardado</h2>
        <p>Los cambios quedaron registrados.</p>
        <Link href={`/admin/actividades/talleres/${state.saved.offerId}`}>Ver taller</Link>
        <Link href="/admin/actividades/talleres">Volver a talleres</Link>
      </section>
    );
  return (
    <form action={action} onReset={(event) => event.preventDefault()} className="activities-stage">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <input type="hidden" name="offer_id" value={offerId ?? ""} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="revision" value={context.revision ?? ""} />
      <p aria-live="polite">
        <strong>
          Paso {step + 1} de 5 · {stages[step]}
        </strong>
      </p>
      <nav
        aria-label="Pasos del taller"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}
      >
        {stages.map((stage, index) => (
          <button
            key={stage}
            type="button"
            onClick={() => setStep(index)}
            aria-current={step === index ? "step" : undefined}
            style={{
              borderRadius: 18,
              padding: "8px 12px",
              border: step === index ? "2px solid #159e78" : "1px solid #bbb",
              fontWeight: step === index ? 700 : 400,
            }}
          >
            {index + 1}. {stage}
          </button>
        ))}
      </nav>
      {context.locked ? (
        <p role="status">
          Por su historial o sus fechas, este taller solo permite cambiar el nombre. Las compras,
          pagos y reservas se conservan.
        </p>
      ) : null}
      {step === 0 ? (
        <section className="workshop-purchase-fields" aria-label="Información">
          <h2>Información general</h2>
          <label className="activities-field">
            <span>Nombre del taller</span>
            <input
              required
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={pending}
            />
          </label>

          <p>
            Define el nombre del taller. Los horarios y precios se configuran en los siguientes
            pasos.
          </p>
        </section>
      ) : null}
      {step === 1 ? (
        <section className="workshop-purchase-fields" aria-label="Fechas">
          <h2>¿Es de una fecha o de varias?</h2>
          <p>Agrega cada fecha aquí mismo, con su horario, disciplina y cupo.</p>
          <h2>Configura las fechas del taller</h2>
          {rows.map((row, index) => (
            <fieldset key={row.key} className="workshop-editor-date">
              <legend>Fecha {index + 1}</legend>
              <div className="activities-form-grid">
                <label className="activities-field">
                  <span>Día</span>
                  <input
                    type="date"
                    required
                    value={row.date}
                    onChange={(event) => updateRow(row.key, { date: event.target.value })}
                  />
                </label>
                <label className="activities-field">
                  <span>Hora</span>
                  <input
                    type="time"
                    required
                    value={row.time}
                    onChange={(event) => updateRow(row.key, { time: event.target.value })}
                  />
                </label>
                <label className="activities-field">
                  <span>Disciplina</span>
                  <select
                    required
                    value={row.disciplineId}
                    onChange={(event) => updateRow(row.key, { disciplineId: event.target.value })}
                  >
                    <option value="">Seleccionar</option>
                    {context.disciplines.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="activities-field">
                  <span>Duración en minutos</span>
                  <input
                    type="number"
                    min="15"
                    max="360"
                    step="1"
                    required
                    value={row.durationMinutes}
                    onChange={(event) =>
                      updateRow(row.key, { durationMinutes: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="activities-field">
                  <span>Cupo</span>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    required
                    value={row.capacity}
                    onChange={(event) =>
                      updateRow(row.key, { capacity: Number(event.target.value) })
                    }
                  />
                </label>
                {allowIndividual ? (
                  <label className="activities-field">
                    <span>Precio individual</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={row.price}
                      onChange={(event) => updateRow(row.key, { price: event.target.value })}
                    />
                  </label>
                ) : null}
                <label className="activities-field">
                  <span>Coach</span>
                  <select
                    value={row.instructorId}
                    onChange={(event) => updateRow(row.key, { instructorId: event.target.value })}
                  >
                    <option value="">Sin asignar</option>
                    {context.instructors.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="activities-field">
                  <span>Espacio</span>
                  <select
                    value={row.spaceId}
                    onChange={(event) => updateRow(row.key, { spaceId: event.target.value })}
                  >
                    <option value="">Sin asignar</option>
                    {context.spaces.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((previous) => previous.filter((item) => item.key !== row.key))
                }
              >
                Quitar fecha {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={rows.length >= 100}
            onClick={() => {
              const row = emptyRow(`new-${sequence.current++}`);
              setRows((previous) => [...previous, row]);
            }}
          >
            Agregar fecha
          </button>

          {!context.disciplines.length ? (
            <p role="alert">Necesitas una disciplina activa para crear las fechas.</p>
          ) : null}
        </section>
      ) : null}
      {step === 2 ? (
        <section className="workshop-purchase-fields" aria-label="Precios">
          <h2>Precios del taller</h2>
          <div className="activities-form-grid">
            <label className="activities-field">
              <span>Precio completo</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={fullPrice}
                onChange={(event) => setFullPrice(event.target.value)}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={allowIndividual}
              onChange={(event) => setAllowIndividual(event.target.checked)}
            />{" "}
            Permitir compra de fechas individuales
          </label>

          {allowIndividual ? (
            <div className="activities-form-grid">
              {rows.map((row, index) => (
                <label className="activities-field" key={row.key}>
                  <span>Precio individual · Fecha {index + 1}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    value={row.price}
                    onChange={(event) => updateRow(row.key, { price: event.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <label className="activities-field">
            <span>¿Requiere inscripción al estudio?</span>
            <select value={enrollment} onChange={(event) => setEnrollment(event.target.value)}>
              <option value="inherit">
                Usar configuración del estudio (
                {context.studioPolicy.requiresEnrollment ? "obligatoria" : "no obligatoria"})
              </option>
              <option value="required">Obligatoria</option>
              <option value="not_required">
                No. El taller se puede comprar sin inscripción al estudio
              </option>
            </select>
          </label>
        </section>
      ) : null}
      {step === 3 ? (
        <section className="workshop-purchase-fields" aria-label="Pagos">
          <h2>Anticipos y saldo</h2>
          <p>
            Elige si el taller requiere pago completo o acepta un anticipo. Para aceptar un pago
            parcial, el saldo completo vence al iniciar la primera fecha adquirida.
          </p>
          <div className="activities-form-grid">
            <label className="activities-field">
              <span>Forma de pago</span>
              <select
                value={depositMode}
                onChange={(event) => {
                  setDepositMode(event.target.value as WorkshopDraft["depositMode"]);
                  setDeposit("50");
                }}
              >
                <option value="full">Pago completo</option>
                <option value="fixed">Anticipo fijo</option>
                <option value="percent">Anticipo porcentual</option>
              </select>
            </label>
            {depositMode !== "full" ? (
              <>
                <label className="activities-field">
                  <span>
                    {depositMode === "fixed" ? "Anticipo fijo" : "Porcentaje de anticipo"}
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    max={depositMode === "percent" ? 100 : undefined}
                    step="0.01"
                    required
                    value={deposit}
                    onChange={(event) => setDeposit(event.target.value)}
                  />
                </label>
                <label className="activities-field">
                  <span>Saldo completo al iniciar la primera fecha</span>
                  <input type="datetime-local" required value={due} readOnly />
                </label>
              </>
            ) : null}
            <label className="activities-field">
              <span>Si vence el saldo</span>
              <select value={overdue} onChange={(event) => setOverdue(event.target.value)}>
                <option value="inherit">Usar configuración del estudio</option>
                <option value="keep_and_notify">Conservar reservas y avisar</option>
                <option value="release_after_grace">Liberar después de la gracia</option>
              </select>
            </label>
            {overdue === "release_after_grace" ? (
              <label className="activities-field">
                <span>Minutos de gracia</span>
                <input
                  type="number"
                  min="0"
                  max="525600"
                  step="1"
                  required
                  value={grace}
                  onChange={(event) => setGrace(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </section>
      ) : null}
      {step === 4 ? (
        <section className="workshop-purchase-fields" aria-label="Revisión">
          <h2>Revisar y guardar</h2>
          <p>
            <strong>{title || "Sin nombre"}</strong>
          </p>
          <p>
            {rows.length} fecha(s) · {fullPrice || "—"} {context.currency}
          </p>
          <p>
            {depositMode === "full"
              ? "Pago completo"
              : depositMode === "fixed"
                ? "Anticipo fijo: " + deposit
                : "Anticipo porcentual: " + deposit + "%"}
          </p>
          <p>{allowIndividual ? "Permite comprar fechas individuales" : "Solo compra completa"}</p>
          <p>Confirma que las fechas, precios y condiciones sean correctos antes de guardar.</p>
          {invalidDraft ? (
            <p role="alert">
              Hay información incompleta. Regresa a los pasos anteriores para corregirla.
            </p>
          ) : null}
        </section>
      ) : null}
      {state.error ? (
        <p className="activities-inline-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        {step > 0 ? (
          <button type="button" onClick={() => setStep((current) => current - 1)}>
            Anterior
          </button>
        ) : null}
        {step < 4 ? (
          <button
            className="activities-next-button"
            type="button"
            disabled={!context.locked && !currentStepValid[step]}
            onClick={() => setStep((current) => current + 1)}
          >
            Siguiente
          </button>
        ) : (
          <button
            className="activities-next-button"
            type="submit"
            disabled={pending || invalidDraft}
          >
            {pending ? "Guardando…" : "Guardar taller"}
          </button>
        )}
      </div>
    </form>
  );
}
