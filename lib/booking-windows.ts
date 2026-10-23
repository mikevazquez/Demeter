// NEB-01-38/39/40 · Reglas de reserva por estudio y por actividad (cancelar, abrir, cerrar y
// registro con QR). Coincide con la migración 20261022217000_neb01_booking_windows.sql.

export type BookingOpenMode = "none" | "relative" | "weekly";

export type BookingWindowValues = {
  cancellationCutoffMinutes: number | null;
  bookingCloseMinutesBefore: number | null;
  bookingOpenMode: BookingOpenMode | null;
  bookingOpenMinutesBefore: number | null;
  bookingOpenWeekday: number | null;
  bookingOpenTime: string | null;
  checkinOpensMinutesBefore: number | null;
  checkinClosesMinutesAfter: number | null;
};

/** Valores de Nébora cuando el estudio no ha configurado nada (los que usa Demeter hoy). */
export const BOOKING_WINDOW_DEFAULTS: BookingWindowValues = {
  cancellationCutoffMinutes: 300,
  bookingCloseMinutesBefore: 30,
  bookingOpenMode: "none",
  bookingOpenMinutesBefore: null,
  bookingOpenWeekday: null,
  bookingOpenTime: null,
  checkinOpensMinutesBefore: 20,
  checkinClosesMinutesAfter: 30,
};

export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const BOOKING_WINDOW_LIMITS = {
  cancellationMinutes: [0, 10080],
  closeMinutes: [0, 10080],
  openMinutes: [60, 129600],
  checkinMinutes: [0, 240],
} as const;

type Raw = Record<string, unknown> | null | undefined;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bookingWindowValuesFromRow(row: Raw): BookingWindowValues {
  const data = row ?? {};
  const mode = data.booking_open_mode;
  return {
    cancellationCutoffMinutes: num(data.cancellation_cutoff_minutes),
    bookingCloseMinutesBefore: num(data.booking_close_minutes_before),
    bookingOpenMode: mode === "none" || mode === "relative" || mode === "weekly" ? mode : null,
    bookingOpenMinutesBefore: num(data.booking_open_minutes_before),
    bookingOpenWeekday: num(data.booking_open_weekday),
    bookingOpenTime:
      typeof data.booking_open_time === "string" ? data.booking_open_time.slice(0, 5) : null,
    checkinOpensMinutesBefore: num(data.checkin_opens_minutes_before),
    checkinClosesMinutesAfter: num(data.checkin_closes_minutes_after),
  };
}

function inRange(value: number | null, [min, max]: readonly [number, number]) {
  return value === null || (Number.isInteger(value) && value >= min && value <= max);
}

export type BookingWindowParseResult =
  | { ok: true; values: BookingWindowValues }
  | { ok: false; error: "cancel" | "close" | "open" | "checkin" };

/**
 * Lee el formulario. En una actividad, un campo vacío significa «como el estudio» (null).
 * En el estudio todos los campos son obligatorios menos los del modo de apertura que no aplica.
 */
export function parseBookingWindowForm(
  formData: FormData,
  scope: "studio" | "activity",
): BookingWindowParseResult {
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const minutes = (key: string, factor = 1) => {
    const raw = text(key);
    if (!raw) return null;
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) ? Math.round(value * factor) : Number.NaN;
  };

  const cancellation = scope === "activity" ? minutes("cancellation_cutoff_hours", 60) : null;
  const close = minutes("booking_close_minutes");
  const checkinBefore = minutes("checkin_opens_minutes");
  const checkinAfter = minutes("checkin_closes_minutes");
  const modeRaw = text("booking_open_mode");
  const mode: BookingOpenMode | null =
    modeRaw === "none" || modeRaw === "relative" || modeRaw === "weekly"
      ? modeRaw
      : scope === "activity"
        ? null
        : "none";

  if (!inRange(cancellation, BOOKING_WINDOW_LIMITS.cancellationMinutes) || Number.isNaN(cancellation))
    return { ok: false, error: "cancel" };
  if (
    Number.isNaN(close) ||
    !inRange(close, BOOKING_WINDOW_LIMITS.closeMinutes) ||
    (scope === "studio" && close === null)
  )
    return { ok: false, error: "close" };
  if (
    Number.isNaN(checkinBefore) ||
    Number.isNaN(checkinAfter) ||
    !inRange(checkinBefore, BOOKING_WINDOW_LIMITS.checkinMinutes) ||
    !inRange(checkinAfter, BOOKING_WINDOW_LIMITS.checkinMinutes) ||
    (scope === "studio" && (checkinBefore === null || checkinAfter === null))
  )
    return { ok: false, error: "checkin" };

  let openMinutes: number | null = null;
  let weekday: number | null = null;
  let time: string | null = null;
  if (mode === "relative") {
    const amount = Number(text("booking_open_amount").replace(",", "."));
    const unit = text("booking_open_unit") === "days" ? 1440 : 60;
    openMinutes = Math.round(amount * unit);
    if (!Number.isFinite(openMinutes) || !inRange(openMinutes, BOOKING_WINDOW_LIMITS.openMinutes))
      return { ok: false, error: "open" };
  } else if (mode === "weekly") {
    weekday = Number(text("booking_open_weekday"));
    time = text("booking_open_time");
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^\d{2}:\d{2}$/.test(time))
      return { ok: false, error: "open" };
  }

  return {
    ok: true,
    values: {
      cancellationCutoffMinutes: cancellation,
      bookingCloseMinutesBefore: close,
      bookingOpenMode: mode,
      bookingOpenMinutesBefore: openMinutes,
      bookingOpenWeekday: weekday,
      bookingOpenTime: time,
      checkinOpensMinutesBefore: checkinBefore,
      checkinClosesMinutesAfter: checkinAfter,
    },
  };
}

/** Texto corto de cuándo abre la reserva, para mostrar la regla. */
export function describeBookingOpen(values: BookingWindowValues): string {
  if (values.bookingOpenMode === "relative" && values.bookingOpenMinutesBefore) {
    const minutes = values.bookingOpenMinutesBefore;
    return minutes % 1440 === 0
      ? `${minutes / 1440} ${minutes === 1440 ? "día" : "días"} antes de la clase`
      : `${Math.round(minutes / 60)} ${minutes === 60 ? "hora" : "horas"} antes de la clase`;
  }
  if (
    values.bookingOpenMode === "weekly" &&
    values.bookingOpenWeekday !== null &&
    values.bookingOpenTime
  ) {
    return `${WEEKDAYS[values.bookingOpenWeekday]} ${values.bookingOpenTime}, toda la semana siguiente`;
  }
  return "Sin límite";
}

/** Mensaje para la alumna cuando la clase aún no abre o ya cerró. */
export function bookingWindowCopy(
  reason: string | null | undefined,
  opensAt: string | null | undefined,
  timeZone: string,
): string | null {
  if (reason === "booking_closed") return "Reservas cerradas";
  if (reason !== "booking_not_open") return null;
  if (!opensAt) return "Todavía no abre";
  const date = new Date(opensAt);
  if (Number.isNaN(date.getTime())) return "Todavía no abre";
  const label = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `Abre ${label}`;
}

/** Estado de la ventana de reserva de una clase (misma regla que usa Demi). */
export function sessionBookingState(
  session: { status: string; starts_at: string },
  window: { opensAt: string | null; closesAt: string } | null | undefined,
  now = Date.now(),
): "open" | "not_open" | "closed" {
  if (session.status !== "scheduled") return "closed";
  if (!window) {
    return new Date(session.starts_at).getTime() > now + 30 * 60_000 ? "open" : "closed";
  }
  if (window.opensAt && now < new Date(window.opensAt).getTime()) return "not_open";
  if (now >= new Date(window.closesAt).getTime()) return "closed";
  return "open";
}
