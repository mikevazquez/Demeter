import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  birthdayInYear,
  birthdayParts,
  birthdaysInMonth,
  birthdaysOn,
  birthdaySummary,
  isBirthdayStudent,
  mexicoToday,
  type BirthdayStudent,
} from "@/app/admin/hoy/birthdays";
import { MonthlyBirthdays } from "@/app/admin/hoy/MonthlyBirthdays";
import { TodayClasses, type TodayClassItem } from "@/app/admin/hoy/TodayClasses";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/admin/actions", () => ({
  cancelReservationFromToday: vi.fn(),
  createWalkinFromToday: vi.fn(),
  setAttendanceFromToday: vi.fn(),
  bookStudentFromToday: vi.fn(),
  searchStudentsForToday: vi.fn(),
  recordPendingClassPaymentAndAttendanceFromToday: vi.fn(),
}));
vi.mock("@/app/admin/alumnas/[studentId]/evaluation-actions", () => ({
  startScheduledEvaluationAction: vi.fn(),
}));

const student: BirthdayStudent = {
  id: "ana",
  name: "Ana García",
  month: 11,
  day: 14,
  packageLabel: "Pole mensual",
};
const regular = {
  active: true,
  lifecycle_status: "active",
  student_type: "regular",
  trial_status: null,
};
const today = "2026-11-14";

describe("Hoy birthday calendar and eligibility", () => {
  it("uses Mexico City at the UTC day boundary", () => {
    expect(mexicoToday(new Date("2026-11-15T05:59:59Z"))).toBe(today);
    expect(mexicoToday(new Date("2026-11-15T06:00:00Z"))).toBe("2026-11-15");
  });
  it.each([null, undefined, "", "2001-02-29", "2000-13-01", "2000-11-31", "14/11/2000", {}, 14])(
    "ignores invalid or missing birth date %s",
    (value) => {
      expect(birthdayParts(value)).toBeNull();
    },
  );
  it("keeps only month and day from a valid birth date", () => {
    expect(birthdayParts("1994-11-14")).toEqual({ month: 11, day: 14 });
  });
  it.each([
    [2026, "02-28"],
    [2028, "02-29"],
    [2100, "02-28"],
    [2000, "02-29"],
  ])("observes leap birthday in %s", (year, suffix) => {
    expect(birthdayInYear({ ...student, month: 2, day: 29 }, Number(year)).date).toBe(
      `${year}-${suffix}`,
    );
  });
  it("includes an active regular student with no enrollment history", () => {
    expect(isBirthdayStudent(regular, [], today)).toBe(true);
  });
  it.each([
    { active: false },
    { lifecycle_status: "inactive" },
    { lifecycle_status: "archived" },
    { lifecycle_status: "prospect" },
    { student_type: "trial", trial_status: "pending" },
    { student_type: "trial", trial_status: "attended" },
    { student_type: "prospect" },
  ])("excludes non-Alumna status %j", (patch) => {
    expect(isBirthdayStudent({ ...regular, ...patch }, [], today)).toBe(false);
  });
  it("uses the CRM enrollment rule for former students", () => {
    expect(
      isBirthdayStudent(
        regular,
        [{ status: "active", starts_on: "2025-01-01", expires_on: "2026-10-01" }],
        today,
      ),
    ).toBe(false);
    expect(
      isBirthdayStudent(
        regular,
        [{ status: "active", starts_on: today, expires_on: "2027-11-14" }],
        today,
      ),
    ).toBe(true);
  });
  it("includes converted trials as regular students", () => {
    expect(
      isBirthdayStudent(
        { ...regular, student_type: "trial", trial_status: "converted" },
        [],
        today,
      ),
    ).toBe(true);
  });
  it("handles week boundaries across years and months", () => {
    const january = { ...student, month: 1, day: 1 };
    expect(birthdaysOn([january], "2027-01-01")[0].date).toBe("2027-01-01");
    expect(birthdaysInMonth([student, january], "2026-12-31")).toEqual([]);
  });
  it("sorts selected-month birthdays and never serializes a birth year", () => {
    const list = birthdaysInMonth(
      [
        student,
        { ...student, id: "bea", name: "Bea", day: 2 },
        { ...student, id: "dec", month: 12 },
      ],
      today,
    );
    expect(list.map((item) => item.date)).toEqual(["2026-11-02", today]);
    expect(Object.keys(list[0])).toEqual(["studentId", "name", "packageLabel", "date"]);
  });
  it("summarizes today, upcoming, past and empty selected months", () => {
    const list = birthdaysInMonth([student, { ...student, id: "bea", name: "Bea" }], today);
    expect(birthdaySummary(list, today, "es-MX")).toBe("Hoy: Ana García y Bea");
    expect(birthdaySummary(list, "2026-11-01", "es-MX")).toBe("Próximo: Ana García · sáb 14 nov");
    expect(birthdaySummary(list, "2026-12-01", "es-MX")).toBe("Ya pasaron todos los de este mes");
    expect(birthdaySummary([], today, "es-MX")).toBe("Sin cumpleaños registrados");
  });
});

describe("Hoy birthday presentation", () => {
  it("starts the monthly panel closed and links rows to the birthday's selected week", () => {
    const html = renderToStaticMarkup(
      <MonthlyBirthdays
        birthdays={birthdaysInMonth([student], today)}
        selectedDate={today}
        today={today}
        locale="es-MX"
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain("Cumpleaños de noviembre");
    expect(html).toContain("/admin?date=2026-11-14");
    expect(html).toContain("Pole mensual");
    expect(html).toContain("Hoy</span>");
  });
  it("uses the selected month instead of the current month", () => {
    const html = renderToStaticMarkup(
      <MonthlyBirthdays birthdays={[]} selectedDate="2026-12-02" today={today} locale="es-MX" />,
    );
    expect(html).toContain("Cumpleaños de diciembre");
    expect(html).toContain("Sin cumpleaños registrados");
  });
  it("opens every class with a birthday and highlights only the birthday student's card", () => {
    const base: TodayClassItem = {
      id: "pole",
      time: "18:00",
      startsAt: "2026-11-15T00:00:00Z",
      endsAt: "2026-11-15T01:00:00Z",
      name: "Pole",
      kindLabel: "Clase",
      instructor: "Coach",
      space: "Principal",
      occupied: 1,
      bookedReservations: 1,
      capacity: 10,
      color: "#8fe6c8",
      sessionStatus: "scheduled",
      available: 9,
      evaluationCount: 0,
      returnTo: "/admin",
      minimumReservationsEnabled: false,
      minimumReservations: 2,
      minimumReviewStatus: "not_required",
      roster: [
        {
          id: "r1",
          studentName: student.name,
          status: "booked",
          packageLabel: "Pole mensual",
          creditsLabel: "4 créditos",
          expiresLabel: "Vence 30 nov",
          isBirthday: true,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <TodayClasses
        classes={[
          base,
          { ...base, id: "flex", name: "Flex", kindLabel: "Taller" },
          { ...base, id: "yoga", name: "Yoga", roster: [{ ...base.roster[0], isBirthday: false }] },
        ]}
        returnDate={today}
        serverNow="2026-11-14T20:00:00Z"
        canAttendance
        canBook
        canCreateStudent
        locale="es-MX"
        timeZone="America/Mexico_City"
      />,
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(html.match(/today-class-birthday-tag/g)).toHaveLength(2);
    expect(html.match(/class="today-class-kind"/g)).toHaveLength(1);
    expect(html).toContain('class="today-class-kind">Taller</small>');
    expect(html.match(/today-student-card compact is-birthday/g)).toHaveLength(2);
    expect(html.match(/today-student-birthday-tag/g)).toHaveLength(2);
    expect(html).toContain('aria-controls="session-yoga"');
    expect(html).toContain('aria-expanded="false"');
  });
});
