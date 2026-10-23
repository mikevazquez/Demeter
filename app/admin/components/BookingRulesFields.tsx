"use client";

import { useState } from "react";

import {
  WEEKDAYS,
  describeBookingOpen,
  type BookingOpenMode,
  type BookingWindowValues,
} from "@/lib/booking-windows";

// NEB-01-38/39/40 · Campos de reglas de reserva. En el estudio todo es obligatorio; en una
// actividad, un campo vacío usa la regla del estudio (se muestra como referencia).
export function BookingRulesFields({
  scope,
  values,
  studio,
}: {
  scope: "studio" | "activity";
  values: BookingWindowValues;
  /** Reglas del estudio, para mostrar qué se hereda en una actividad. */
  studio?: BookingWindowValues;
}) {
  const initialMode = values.bookingOpenMode ?? (scope === "activity" ? "" : "none");
  const [mode, setMode] = useState<BookingOpenMode | "">(initialMode);
  const openMinutes = values.bookingOpenMinutesBefore;
  const openInDays = openMinutes !== null && openMinutes % 1440 === 0;
  const inherit = (value: number | null | undefined, unit: string) =>
    scope === "activity" && value !== null && value !== undefined
      ? `Vacío = como el estudio (${value} ${unit})`
      : undefined;

  return (
    <div className="booking-rules-fields">
      {scope === "activity" ? (
        <label className="booking-rules-field">
          <span>Cancelar sin penalización hasta</span>
          <div className="booking-rules-unit">
            <input
              name="cancellation_cutoff_hours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              inputMode="decimal"
              defaultValue={
                values.cancellationCutoffMinutes === null
                  ? ""
                  : values.cancellationCutoffMinutes / 60
              }
              placeholder={
                studio?.cancellationCutoffMinutes != null
                  ? String(studio.cancellationCutoffMinutes / 60)
                  : ""
              }
            />
            <b>horas antes</b>
          </div>
          <small>
            {studio?.cancellationCutoffMinutes != null
              ? `Vacío = como el estudio (${studio.cancellationCutoffMinutes / 60} h).`
              : "Vacío = como el estudio."}
          </small>
        </label>
      ) : null}

      <label className="booking-rules-field">
        <span>Abrir reservas</span>
        <select
          name="booking_open_mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as BookingOpenMode | "")}
        >
          {scope === "activity" ? (
            <option value="">
              Como el estudio{studio ? ` (${describeBookingOpen(studio)})` : ""}
            </option>
          ) : null}
          <option value="none">Sin límite: se puede reservar cualquier semana</option>
          <option value="relative">Cierto tiempo antes de cada clase</option>
          <option value="weekly">Un día y hora fijos para toda la semana siguiente</option>
        </select>
      </label>

      {mode === "relative" ? (
        <label className="booking-rules-field">
          <span>Se abre</span>
          <div className="booking-rules-unit booking-rules-split">
            <input
              name="booking_open_amount"
              type="number"
              min="1"
              max="90"
              inputMode="numeric"
              defaultValue={
                openMinutes === null ? "" : openInDays ? openMinutes / 1440 : openMinutes / 60
              }
              required
            />
            <select
              name="booking_open_unit"
              defaultValue={openInDays || openMinutes === null ? "days" : "hours"}
            >
              <option value="days">días antes</option>
              <option value="hours">horas antes</option>
            </select>
          </div>
          <small>Ejemplo: 7 días antes abre cada clase una semana antes.</small>
        </label>
      ) : null}

      {mode === "weekly" ? (
        <div className="booking-rules-row">
          <label className="booking-rules-field">
            <span>Día</span>
            <select name="booking_open_weekday" defaultValue={values.bookingOpenWeekday ?? 0}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label className="booking-rules-field">
            <span>Hora</span>
            <input
              name="booking_open_time"
              type="time"
              defaultValue={values.bookingOpenTime ?? "20:00"}
              required
            />
          </label>
          <small className="booking-rules-note">
            Ese día y hora se abren todas las clases de la semana siguiente (lunes a domingo).
          </small>
        </div>
      ) : null}

      <label className="booking-rules-field">
        <span>Cerrar reservas</span>
        <div className="booking-rules-unit">
          <input
            name="booking_close_minutes"
            type="number"
            min="0"
            max="10080"
            inputMode="numeric"
            defaultValue={values.bookingCloseMinutesBefore ?? ""}
            placeholder={studio?.bookingCloseMinutesBefore?.toString() ?? ""}
            required={scope === "studio"}
          />
          <b>minutos antes</b>
        </div>
        <small>
          {inherit(studio?.bookingCloseMinutesBefore, "min") ??
            "Después de esto la alumna y Demi ya no pueden reservar. Recepción sí."}
        </small>
      </label>

      <div className="booking-rules-row">
        <label className="booking-rules-field">
          <span>Registro con QR abre</span>
          <div className="booking-rules-unit">
            <input
              name="checkin_opens_minutes"
              type="number"
              min="0"
              max="240"
              inputMode="numeric"
              defaultValue={values.checkinOpensMinutesBefore ?? ""}
              placeholder={studio?.checkinOpensMinutesBefore?.toString() ?? ""}
              required={scope === "studio"}
            />
            <b>min antes</b>
          </div>
          {inherit(studio?.checkinOpensMinutesBefore, "min") ? (
            <small>{inherit(studio?.checkinOpensMinutesBefore, "min")}</small>
          ) : null}
        </label>
        <label className="booking-rules-field">
          <span>Registro con QR cierra</span>
          <div className="booking-rules-unit">
            <input
              name="checkin_closes_minutes"
              type="number"
              min="0"
              max="240"
              inputMode="numeric"
              defaultValue={values.checkinClosesMinutesAfter ?? ""}
              placeholder={studio?.checkinClosesMinutesAfter?.toString() ?? ""}
              required={scope === "studio"}
            />
            <b>min después</b>
          </div>
          {inherit(studio?.checkinClosesMinutesAfter, "min") ? (
            <small>{inherit(studio?.checkinClosesMinutesAfter, "min")}</small>
          ) : null}
        </label>
      </div>
    </div>
  );
}
