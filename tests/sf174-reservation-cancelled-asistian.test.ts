import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReservationCancelledVariables,
  reservationCancelledIdempotencyKey,
} from "../supabase/functions/process-booking-cancelled/reservation-cancelled";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-174 reservation_cancelled Asistian routing", () => {
  const processor = source("supabase/functions/process-booking-cancelled/index.ts");
  const migration = source(
    "supabase/migrations/20260921063752_sf174_booking_cancelled_dispatch.sql",
  );

  it("emits one canonical booking.cancelled event from reservation state transition", () => {
    expect(migration).toContain("p_event_type => 'booking.cancelled'");
    expect(migration).toContain("'booking.cancelled:' || new.id::text");
    expect(migration).toContain("old.status = 'reserved'");
    expect(migration).toContain(
      "new.status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio')",
    );
    expect(migration).toContain("new.student_id is not null");
  });

  it("dispatches the canonical event to the cancellation processor", () => {
    expect(migration).toContain("/functions/v1/process-booking-cancelled");
    expect(migration).toContain("new.event_type = 'booking.cancelled'");
    expect(processor).toContain('dispatchEvent.event_type !== "booking.cancelled"');
  });

  it("uses the shared Asistian transport and preserves execution idempotency", () => {
    expect(processor).toContain(
      'import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts"',
    );
    expect(processor).toContain("await sendAsistianWebhook({");
    expect(processor).toContain('p_provider_key: "asistian"');
    expect(processor).not.toContain("MockMessagingProvider");
    expect(reservationCancelledIdempotencyKey("abc")).toBe("sf174:reservation_cancelled:abc");
  });

  it("reports an on-time cancellation as credit recovered for a limited package", () => {
    const variables = buildReservationCancelledVariables({
      className: "Pole Fitness",
      startsAt: "2026-09-22T14:30:00.000Z",
      timeZone: "America/Mexico_City",
      cancellationStatus: "cancelled_on_time",
      unlimited: false,
      hasRelease: true,
      hasConsume: false,
      creditsRemaining: 6,
    });

    expect(variables).toMatchObject({
      clase: "Pole Fitness",
      tipo_cancelacion: "A tiempo",
      credito_recuperado: true,
      creditos_restantes: 6,
    });
  });

  it("reports a late cancellation as credit not recovered", () => {
    const variables = buildReservationCancelledVariables({
      className: "Pole Fitness",
      startsAt: "2026-09-22T14:30:00.000Z",
      timeZone: "America/Mexico_City",
      cancellationStatus: "cancelled_late",
      unlimited: false,
      hasRelease: true,
      hasConsume: true,
      creditsRemaining: 5,
    });

    expect(variables).toMatchObject({
      tipo_cancelacion: "Tardía",
      credito_recuperado: false,
      creditos_restantes: 5,
    });
  });

  it("marks unlimited memberships as not applicable for recovered credit", () => {
    const variables = buildReservationCancelledVariables({
      className: "Pole Fitness",
      startsAt: "2026-09-22T14:30:00.000Z",
      timeZone: "America/Mexico_City",
      cancellationStatus: "cancelled_by_studio",
      unlimited: true,
      hasRelease: false,
      hasConsume: false,
      creditsRemaining: null,
    });

    expect(variables).toMatchObject({
      tipo_cancelacion: "Por el estudio",
      credito_recuperado: null,
      creditos_restantes: null,
    });
  });
});
