import reference from "./reference-catalog.json";

export type CalendarDay = {
  date: string;
  name: string;
  official: boolean;
  suggest: "normal" | "closed";
};
export type CalendarEvent = {
  id: string;
  studio_id: string | null;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  kind: string;
  icon: string;
  accent: string;
  secondary: string;
  message: string;
  commemorated_on: string | null;
  legal_basis: string | null;
  days: CalendarDay[];
};
export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateKey(value);
}
/** Gregorian Easter, Meeus/Jones/Butcher. UTC date arithmetic is independent
 * of the studio clock; only the caller's "today" uses the studio timezone. */
export function easterDate(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  return dateKey(
    new Date(
      Date.UTC(
        year,
        Math.floor((h + l - 7 * m + 114) / 31) - 1,
        ((h + l - 7 * m + 114) % 31) + 1,
        12,
      ),
    ),
  );
}
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  return dateKey(
    new Date(
      Date.UTC(year, month - 1, 1 + ((weekday - first.getUTCDay() + 7) % 7) + 7 * (nth - 1), 12),
    ),
  );
}
export function nationalCalendar(year: number): Omit<CalendarEvent, "id">[] {
  return reference
    .filter(
      (item) =>
        (item.code !== "poder" || (year - 2024) % 6 === 0) &&
        (item.code !== "elecciones" || year === 2027),
    )
    .map((item) => {
      let start = dateKey(new Date(Date.UTC(year, item.month - 1, item.day, 12)));
      if (item.code === "constitucion") start = nthWeekday(year, 2, 1, 1);
      if (item.code === "juarez") start = nthWeekday(year, 3, 1, 3);
      if (item.code === "revolucion") start = nthWeekday(year, 11, 1, 3);
      if (item.code === "padre") start = nthWeekday(year, 6, 0, 3);
      if (item.code === "santa") start = shiftDate(easterDate(year), -7);
      if (item.code === "pascua") start = easterDate(year);
      const days = Array.from({ length: item.length }, (_, index) => {
        const definition = item.days?.[index];
        const official = item.kind === "oficial" || definition?.[1] === "oficial";
        return {
          date: shiftDate(start, index),
          name: definition?.[0] ?? item.name,
          official,
          suggest: (official || definition?.[2] === "closed" ? "closed" : "normal") as
            "normal" | "closed",
        };
      });
      const commemorations: Record<string, string> = {
        constitucion: `${year}-02-05`,
        juarez: `${year}-03-21`,
        revolucion: `${year}-11-20`,
      };
      return {
        studio_id: null,
        code: item.code,
        name: item.name,
        starts_on: start,
        ends_on: days.at(-1)!.date,
        kind: item.kind,
        icon: item.icon,
        accent: item.accent,
        secondary: item.secondary,
        message: item.message,
        commemorated_on: commemorations[item.code] ?? null,
        legal_basis: item.legal,
        days,
      };
    })
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}
export const CALENDAR_KIND_LABELS: Record<string, string> = {
  oficial: "Festivo oficial",
  civica: "Fecha cívica",
  religiosa: "Fecha religiosa",
  tradicion: "Tradición",
  propia: "Fecha del estudio",
};
