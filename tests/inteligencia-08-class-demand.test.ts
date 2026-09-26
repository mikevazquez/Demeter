import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-08 class demand intelligence", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("reconstructs booking lifecycle per session from immutable events", () => {
    expect(intelligence).toContain("bookingLifecycleEventsBySession");
    expect(intelligence).toContain("sessionDemandLifecycle");
    expect(intelligence).toContain('event.event_type !== "booking.created"');
    expect(intelligence).toContain('event.event_type !== "booking.cancelled"');
    expect(intelligence).toContain('=== "cancelled_by_studio"');
  });

  it("measures peak simultaneous demand before cancellations", () => {
    expect(intelligence).toContain("peakReserved");
    expect(intelligence).toContain("activeReservationIds");
    expect(intelligence).toContain("peakReserved = Math.max");
    expect(intelligence).toContain("peakOccupancy");
  });

  it("tracks whether a cancelled place was refilled", () => {
    expect(intelligence).toContain("pendingCancelledSeats");
    expect(intelligence).toContain("refilledSeats");
    expect(intelligence).toContain("cancellationRefill");
    expect(intelligence).toContain("Lugares recuperados");
  });

  it("does not recommend expansion from final occupancy alone", () => {
    expect(intelligence).toContain("highestDemand.peakOccupancy >= 90");
    expect(intelligence).toContain("highestDemand.attendanceCapacity >= 70");
    expect(intelligence).toContain("row.sessionCount >= 3");
  });

  it("distinguishes recovered cancellations from real lost capacity", () => {
    expect(intelligence).toContain("Lugares perdidos por cancelación");
    expect(intelligence).toContain("Cancelaciones con recuperación");
    expect(intelligence).toContain("Lugar recuperado");
    expect(intelligence).toContain("Capacidad bloqueada");
  });

  it("uses peak demand for daypart and weekday analysis", () => {
    expect(intelligence).toContain("sessionLifecycleMap.get(session.id)?.peakReserved");
    expect(intelligence).toContain('title="🕒 Demanda pico por franja"');
    expect(intelligence).toContain('title="Demanda pico por día"');
  });
});
