"use client";
import { useActionState } from "react";
import { enrollProgram } from "../actions";
export function EnrollmentForm({
  programId,
  students,
  options,
  requestId,
}: {
  programId: string;
  students: { id: string; name: string }[];
  options: { id: string; name: string }[];
  requestId: string;
}) {
  const [state, action, pending] = useActionState(enrollProgram, { error: null });
  return (
    <form action={action} className="activities-stage">
      <h2>Inscribir y asegurar cupo</h2>
      <p>
        Registra un pago recibido. Se guardan la compra y todas las reservas juntas; si falta un
        lugar, no se registra ningún cargo.
      </p>
      <input name="program_id" value={programId} type="hidden" />
      <input name="request_id" value={requestId} type="hidden" />
      <div className="activities-form-grid">
        <label className="activities-field">
          <span>Alumna</span>
          <select name="student_id" required>
            <option value="">Seleccionar</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="activities-field">
          <span>Qué compra</span>
          <select name="session_id">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="activities-field">
          <span>Pago recibido por</span>
          <select name="payment_method">
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia verificada</option>
          </select>
        </label>
        <label className="activities-field">
          <span>Referencia</span>
          <input name="reference" maxLength={100} />
        </label>
      </div>
      <label>
        <input name="payment_verified" type="checkbox" required /> Ya recibí y verifiqué el pago
        completo de la opción elegida.
      </label>
      {state.error ? (
        <p role="alert" className="activities-inline-error">
          {state.error}
        </p>
      ) : null}
      <p>
        <button type="submit" className="activities-next-button" disabled={pending}>
          {pending ? "Inscribiendo…" : "Registrar pago e inscripción"}
        </button>
      </p>
    </form>
  );
}
