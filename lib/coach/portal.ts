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

export type CoachRosterItem = {
  reservation_id: string;
  student_id: string | null;
  student_name: string;
  attendance_status: "reserved" | "attended" | "no_show";
  package_name: string | null;
  commercial_pending: boolean;
};

export type CoachResourceChoice = {
  resource_id: string;
  name: string;
  short_label: string | null;
  type_name: string;
  enabled: boolean;
  capacity: number;
  used: number;
  available: number;
};

export type CoachMapElement = {
  id: string;
  resource_id: string | null;
  element_kind: string;
  label: string | null;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  rotation_degrees: number | string;
  z_index: number;
};

export type CoachResourceMap = {
  session_id: string;
  requires_resource: boolean;
  default_uses: number;
  map: {
    space_id: string;
    canvas_width: number;
    canvas_height: number;
    revision: number;
  } | null;
  resources: CoachResourceChoice[];
  elements: CoachMapElement[];
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

export function formatLongDate(value: string, locale = "es-MX") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatSessionDate(value: string, timeZone: string, locale = "es-MX") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

export function formatTime(value: string, timeZone: string, locale = "es-MX") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
