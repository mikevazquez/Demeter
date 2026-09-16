import "server-only";

export type CoachSession = {
  session_id: string;
  starts_at: string;
  ends_at: string;
  session_status: "scheduled" | "cancelled" | "completed";
  capacity: number;
  template_name: string;
  space_name: string | null;
  reserved_count: number;
};

export type CoachSessionDetail = {
  session_id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled" | "completed";
  capacity: number;
  activity: string;
  space: string | null;
  notes: string | null;
  reserved_count: number;
};

export function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isDateKey(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatSessionDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

export function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
