import { resolveEnrollmentStatus } from "@/lib/assistant/enrollment-state";
import { contactStage } from "@/lib/student-crm";
import { DEFAULT_STUDIO_TIME_ZONE, studioLocalDateKey } from "@/lib/studio-time";

// NEB-01-35 · Los cumpleaños se cuentan en la hora del estudio.
export const BIRTHDAY_TIME_ZONE = DEFAULT_STUDIO_TIME_ZONE;

export type BirthdayStudent = {
  id: string;
  name: string;
  month: number;
  day: number;
  packageLabel: string;
};

export type BirthdayOccurrence = {
  studentId: string;
  name: string;
  date: string;
  packageLabel: string;
};

export function mexicoToday(now: Date, timeZone: string = BIRTHDAY_TIME_ZONE) {
  return studioLocalDateKey(timeZone, now);
}

// Validate dates as calendar values, without converting a birthday to local time.
export function birthdayParts(value: unknown): { month: number; day: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function isBirthdayStudent(
  student: {
    active: boolean;
    lifecycle_status: string;
    student_type: string;
    trial_status: string | null;
  },
  enrollments: Parameters<typeof resolveEnrollmentStatus>[0],
  today: string,
) {
  return (
    student.active &&
    student.lifecycle_status === "active" &&
    (student.student_type === "regular" ||
      (student.student_type === "trial" && student.trial_status === "converted")) &&
    contactStage({ ...student, enrollment_status: resolveEnrollmentStatus(enrollments, today) }) ===
      "student"
  );
}

export function birthdayInYear(student: BirthdayStudent, year: number): BirthdayOccurrence {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const day = student.month === 2 && student.day === 29 && !leap ? 28 : student.day;
  return {
    studentId: student.id,
    name: student.name,
    packageLabel: student.packageLabel,
    date: `${year}-${String(student.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function birthdaysOn(students: BirthdayStudent[], date: string) {
  return students
    .map((student) => birthdayInYear(student, Number(date.slice(0, 4))))
    .filter((student) => student.date === date);
}

export function birthdaysInMonth(students: BirthdayStudent[], selectedDate: string) {
  return students
    .map((student) => birthdayInYear(student, Number(selectedDate.slice(0, 4))))
    .filter((student) => student.date.slice(0, 7) === selectedDate.slice(0, 7))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "es-MX"));
}

export function birthdaySummary(birthdays: BirthdayOccurrence[], today: string, locale: string) {
  if (!birthdays.length) return "Sin cumpleaños registrados";
  const current = birthdays.filter((student) => student.date === today);
  if (current.length) return `Hoy: ${current.map((student) => student.name).join(" y ")}`;
  const next = birthdays.find((student) => student.date > today);
  if (!next) return "Ya pasaron todos los de este mes";
  const date = new Date(`${next.date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
      .format(date)
      .replace(/\./g, "");
  return `Próximo: ${next.name} · ${part({ weekday: "short" })} ${date.getUTCDate()} ${part({ month: "short" })}`;
}
