// CUMP-01 · Pase de regalo de cumpleaños: tipos y reglas compartidas por el portal y el equipo.
// Coincide con supabase/migrations/20261023101000_birthday_gift_v1.sql.

export type BirthdayPassSnapshot = {
  eligible: boolean;
  reason_code?: string | null;
  pass_id?: string | null;
  state?: "available" | "used" | "expired";
  period_start?: string | null;
  expires_on?: string | null;
  today?: string | null;
  recipient_kind?: "self" | "friend" | null;
  recipient_name?: string | null;
  used_session_id?: string | null;
  used_class_name?: string | null;
  used_starts_at?: string | null;
  used_at?: string | null;
  is_birthday?: boolean;
  friend_enabled?: boolean;
};

export type AdminBirthdayPass = {
  has_birth_date: boolean;
  birthday_month?: number;
  in_birthday_month?: boolean;
  is_birthday?: boolean;
  gift_enabled: boolean;
  current_student?: boolean;
  pass?: {
    state: "available" | "used" | "expired";
    period_start: string;
    expires_on: string;
    recipient_kind: "self" | "friend" | null;
    recipient_name?: string | null;
    used_class_name?: string | null;
    used_starts_at?: string | null;
    used_at?: string | null;
  } | null;
};

const DAY_MS = 86_400_000;

function dateKeyToUtcNoon(value: string) {
  return Date.parse(`${value}T12:00:00Z`);
}

/** Días que le quedan para usar el pase, contando hoy (fecha local del estudio). */
export function birthdayPassDaysLeft(today: string | null | undefined, expiresOn: string | null | undefined) {
  if (!today || !expiresOn) return null;
  const start = dateKeyToUtcNoon(today);
  const end = dateKeyToUtcNoon(expiresOn);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / DAY_MS) + 1);
}

/** Fecha corta en español sin zona horaria (las fechas del pase ya son locales del estudio). */
export function birthdayDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const time = dateKeyToUtcNoon(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(time),
  );
}

/**
 * ¿Se puede ofrecer el pase en esta clase? Solo con el pase disponible, clase programada sin
 * lugar a elegir, con cupo y con fecha local dentro del mes del pase.
 */
export function birthdayPassFitsSession(
  pass: BirthdayPassSnapshot | null | undefined,
  session: {
    status?: string | null;
    starts_at: string;
    requires_resource?: boolean | null;
    spots_available?: number | null;
  },
  sessionDateKey: string,
) {
  if (!pass?.eligible || pass.state !== "available") return false;
  if (!pass.period_start || !pass.expires_on) return false;
  if (session.status && session.status !== "scheduled") return false;
  if (session.requires_resource) return false;
  if (typeof session.spots_available === "number" && session.spots_available <= 0) return false;
  return sessionDateKey >= pass.period_start && sessionDateKey <= pass.expires_on;
}

/** Normaliza el WhatsApp de la amiga: 10 dígitos de México o número con lada internacional. */
export function normalizeBirthdayFriendPhone(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  const digits = compact.replace(/\D/g, "");
  if (/^\d{10}$/.test(compact)) return `+52${compact}`;
  if (compact.startsWith("+") && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

export const BIRTHDAY_BOOKING_ERRORS: Record<string, string> = {
  birthday_gift_disabled: "El regalo de cumpleaños no está activo en este estudio.",
  birthday_friend_disabled: "En este estudio el pase de cumpleaños es solo para ti.",
  birthday_pass_already_used: "Tu pase de cumpleaños ya fue utilizado.",
  birthday_pass_outside_validity: "El pase solo sirve para clases de tu mes de cumpleaños.",
  birthday_pass_not_in_month: "El pase solo está disponible durante tu mes de cumpleaños.",
  birthday_pass_not_for_workshops: "El pase de cumpleaños no aplica para talleres.",
  birthday_pass_resource_unsupported:
    "Esta clase requiere elegir lugar; usa tu pase en otra clase o pide ayuda en recepción.",
  birth_date_required: "Necesitamos tu fecha de nacimiento para activar el regalo.",
  session_full: "Esta clase ya está llena. Elige otra clase de tu mes.",
  session_not_bookable: "Esta clase ya no se puede reservar.",
  already_reserved: "Ya tienes esta clase reservada. Puedes regalar tu pase a una amiga.",
  friend_already_reserved: "Tu amiga ya tiene lugar en esta clase.",
  friend_name_required: "Escribe el nombre de tu amiga.",
  friend_phone_invalid: "Escribe el WhatsApp de tu amiga a 10 dígitos.",
  friend_is_self: "Ese WhatsApp es el tuyo. Para usar el pase tú, elige «Para mí».",
  recipient_invalid: "Elige si el pase es para ti o para una amiga.",
  booking_not_open: "Esta clase todavía no abre reservas.",
  booking_closed: "Las reservas de esta clase ya cerraron.",
  student_booking_blocked: "Tus reservas están en pausa por ahora.",
  student_charge_pending: "Tienes un adeudo pendiente; pásalo en recepción para reservar.",
};

export function birthdayBookingErrorCopy(code: string | null | undefined) {
  if (!code) return null;
  return BIRTHDAY_BOOKING_ERRORS[code] ?? "No pudimos usar tu pase. Intenta de nuevo.";
}
