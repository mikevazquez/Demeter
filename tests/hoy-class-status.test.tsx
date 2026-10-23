import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TodayClasses, type TodayClassItem } from "@/app/admin/hoy/TodayClasses";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/admin/hoy/SessionOperations", () => ({ SessionOperations: () => null }));

const item: TodayClassItem = {
  id: "test-class",
  time: "18:00",
  startsAt: "2026-10-19T00:00:00Z",
  endsAt: "2026-10-19T01:00:00Z",
  name: "Pole Fitness",
  kindLabel: "Clase",
  instructor: "Coach",
  space: "Principal",
  occupied: 8,
  bookedReservations: 8,
  capacity: 8,
  color: "#8fe6c8",
  sessionStatus: "scheduled",
  roster: [],
  available: 0,
  evaluationCount: 0,
  returnTo: "/admin",
  minimumReservationsEnabled: false,
  minimumReservations: 2,
  minimumReviewStatus: "not_required",
};

function render(patch: Partial<TodayClassItem> = {}) {
  return renderToStaticMarkup(
    <TodayClasses
      classes={[{ ...item, ...patch }]}
      returnDate="2026-10-18"
      serverNow="2026-10-18T18:00:00Z"
      canAttendance
      canBook
      canCreateStudent
      locale="es-MX"
      timeZone="America/Mexico_City"
    />,
  );
}

describe("Hoy class occupancy and waitlist states", () => {
  it("identifies a full scheduled class", () => {
    expect(render()).toContain("Llena");
  });
  it("does not label a cancelled class full even when no places remain", () => {
    const html = render({ sessionStatus: "cancelled" });
    expect(html).toContain("Cancelada");
    expect(html).not.toContain("Llena");
  });
  it("keeps partially booked classes available", () => {
    expect(render({ occupied: 5, bookedReservations: 5, available: 3 })).not.toContain("Llena");
  });
  it("shows waitlist size separately without exposing collapsed participant names", () => {
    const html = render({
      waitlist: [
        { id: "w1", studentName: "Elena" },
        { id: "w2", studentName: "Daniela" },
      ],
    });
    expect(html).toContain("2 en espera");
    expect(html).not.toContain("Elena");
    expect(html).not.toContain("Daniela");
  });
  it("does not display a waitlist badge for an empty list", () => {
    expect(render({ waitlist: [] })).not.toContain("en espera");
  });
  it("does not add a type badge to ordinary daily classes", () => {
    expect(render()).not.toContain('class="today-class-kind"');
    expect(render()).toContain("Pole Fitness");
  });
  it.each(["Taller", "Evento", "Masterclass"])(
    "labels %s sessions without changing their name",
    (kindLabel) => {
      const html = render({ name: "Nombre de la actividad", kindLabel });
      expect(html).toContain(`class="today-class-kind">${kindLabel}</small>`);
      expect(html).toContain("Nombre de la actividad");
    },
  );
  it("shows the special session type separately from the activity name", () => {
    const html = render({ name: "Aro prueba", kindLabel: "Taller" });
    expect(html).toContain("Taller");
    expect(html).toContain("Aro prueba");
  });
});
