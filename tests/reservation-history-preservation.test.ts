import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  countSeatOccupyingReservations,
  isSeatOccupyingReservation,
} from "../lib/reservations/capacity";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("reservation history preservation", () => {
  const today = source("app/admin/page.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const sessionDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("keeps no-shows in booked-seat counts after attendance closes", () => {
    const statuses = [
      "reserved",
      "attended",
      "no_show",
      "cancelled_on_time",
      "cancelled_late",
    ];

    expect(statuses.filter(isSeatOccupyingReservation)).toEqual([
      "reserved",
      "attended",
      "no_show",
    ]);
    expect(countSeatOccupyingReservations(statuses)).toBe(3);
    expect(today).toContain("countSeatOccupyingReservations(");
    expect(agenda).toContain("isSeatOccupyingReservation(reservation.status)");
    expect(sessionDetail).toContain("countSeatOccupyingReservations(");
  });

  it("keeps cancellations as historical decision data without counting them as occupied seats", () => {
    expect(intelligence).toContain('"cancelled_on_time"');
    expect(intelligence).toContain('"cancelled_late"');
    expect(intelligence).toContain('"cancelled_by_studio"');
    expect(intelligence).toContain(
      'const occupiedStatuses = new Set(["reserved", "attended", "no_show"]);',
    );
  });
});
