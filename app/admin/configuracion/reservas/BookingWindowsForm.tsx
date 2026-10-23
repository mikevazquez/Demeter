"use client";

import { useFormStatus } from "react-dom";

import { BookingRulesFields } from "@/app/admin/components/BookingRulesFields";
import type { BookingWindowValues } from "@/lib/booking-windows";

import { saveBookingWindowsAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="booking-rules-save" disabled={pending}>
      {pending ? "Guardando…" : "Guardar apertura y registro"}
    </button>
  );
}

// NEB-01-39/40 · Cuándo se abre y se cierra la reserva y cuándo funciona el QR.
export function BookingWindowsForm({ values }: { values: BookingWindowValues }) {
  return (
    <form action={saveBookingWindowsAction} className="booking-rules-card">
      <header>
        <h2>Apertura, cierre y registro</h2>
        <p>
          Cuándo pueden reservar las alumnas y Demi, y cuándo funciona el QR de la clase. Cada
          actividad puede tener sus propias reglas.
        </p>
      </header>
      <BookingRulesFields scope="studio" values={values} />
      <SubmitButton />
    </form>
  );
}
