"use client";

import { useFormStatus } from "react-dom";

import { BookingRulesFields } from "@/app/admin/components/BookingRulesFields";
import type { BookingWindowValues } from "@/lib/booking-windows";

import { saveActivityBookingRulesAction } from "./booking-rules-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="booking-rules-save" disabled={pending}>
      {pending ? "Guardando…" : "Guardar reglas de esta actividad"}
    </button>
  );
}

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  guardado: { tone: "success", text: "Reglas guardadas." },
  error_cancel: { tone: "error", text: "Revisa las horas para cancelar (0 a 168)." },
  error_close: { tone: "error", text: "Revisa los minutos para cerrar reservas." },
  error_open: { tone: "error", text: "Revisa cuándo se abren las reservas." },
  error_checkin: { tone: "error", text: "Revisa los minutos del registro con QR (0 a 240)." },
  error_save: { tone: "error", text: "No pudimos guardar las reglas." },
};

// NEB-01-38/39/40 · Cancelación, apertura, cierre y QR propios de una actividad.
export function ActivityBookingRulesForm({
  activityId,
  values,
  studio,
  notice,
}: {
  activityId: string;
  values: BookingWindowValues;
  studio: BookingWindowValues;
  notice?: string;
}) {
  const message = notice ? NOTICES[notice] : null;
  return (
    <form action={saveActivityBookingRulesAction} className="booking-rules-card" id="reglas-reserva">
      <input type="hidden" name="activity_id" value={activityId} />
      <header>
        <h2>Reglas de reserva de esta actividad</h2>
        <p>
          Déjalas vacías para usar las del estudio. Úsalas, por ejemplo, para que un taller se
          cancele con más anticipación o abra antes.
        </p>
      </header>
      {message ? (
        <p className={`booking-rules-notice is-${message.tone}`} role="status">
          {message.text}
        </p>
      ) : null}
      <BookingRulesFields scope="activity" values={values} studio={studio} />
      <SubmitButton />
    </form>
  );
}
