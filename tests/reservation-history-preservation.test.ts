import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("reservation history preservation", () => {
  const today = source("app/admin/page.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const sessionDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("keeps no-shows in booked-seat counts after attendance closes", () => {
    expect(today).toContain(
      'const occupyingReservationStatuses = new Set(["reserved", "attended", "no_show"]);',
    );
    expect(agenda).toContain(
      'if (!["reserved", "attended", "no_show"].includes(reservation.status)) continue;',
    );
    expect(sessionDetail).toContain(
      '["reserved", "attended", "no_show"].includes(reservation.status),',
    );
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
