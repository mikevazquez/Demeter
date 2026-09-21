import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWaitlistPromotedConditions,
  buildWaitlistPromotedVariables,
  waitlistPromotedIdempotencyKey,
} from "../supabase/functions/process-waitlist-promoted/waitlist-promoted";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-174 waitlist_promoted Asistian routing", () => {
  const processor = source("supabase/functions/process-waitlist-promoted/index.ts");
  const genericBooking = source("supabase/functions/process-booking-created/index.ts");
  const migration = source(
    "supabase/migrations/20260921064925_sf174_waitlist_promoted_asistian.sql",
  );

  it("uses a dedicated AUT-CAT-17 processor and Asistian transport", () => {
    expect(processor).toContain("WAITLIST_PROMOTED_CATALOG_CODE");
    expect(processor).toContain("template: WAITLIST_PROMOTED_TEMPLATE");
    expect(processor).toContain('p_provider_key: "asistian"');
    expect(processor).toContain("await sendAsistianWebhook({");
    expect(processor).not.toContain("MockMessagingProvider");
  });

  it("accepts only booking.created events that actually came from waitlist", () => {
    expect(processor).toContain('dispatchEvent.event_type !== "booking.created"');
    expect(processor).toContain('eventSource !== "waitlist"');
    expect(processor).toContain("waitlist_entry_id");
    expect(processor).toContain('error: "waitlist_event_invalid"');
  });

  it("keeps generic reservation confirmation excluded for waitlist source", () => {
    expect(genericBooking).toContain('if (eventSource === "waitlist")');
    expect(genericBooking).toContain('reason: "waitlist_routed_separately"');
    expect(genericBooking).not.toContain('template: "waitlist_promoted"');
  });

  it("dispatches only booking.created source=waitlist to the dedicated processor", () => {
    expect(migration).toContain("/functions/v1/process-waitlist-promoted");
    expect(migration).toContain("new.event_type = 'booking.created'");
    expect(migration).toContain("new.payload->>'source'");
    expect(migration).toContain("'waitlist'");
  });

  it("keeps one execution per promoted reservation", () => {
    expect(waitlistPromotedIdempotencyKey("abc")).toBe("sf174:waitlist_promoted:abc");
  });

  it("builds the student-facing class context", () => {
    const variables = buildWaitlistPromotedVariables({
      studentName: "UAT Waitlist",
      discipline: "Pole Fitness",
      startsAt: "2026-09-22T14:30:00.000Z",
      timeZone: "America/Mexico_City",
      coach: "Mike",
      location: "Principal",
      creditsRemaining: 6,
    });

    expect(variables).toMatchObject({
      nombre: "UAT Waitlist",
      disciplina: "Pole Fitness",
      fecha: "22/09/2026",
      hora: "08:30",
      coach: "Mike",
      ubicacion: "Principal",
      creditos_restantes: 6,
    });
  });

  it("requires waitlist provenance, a valid reservation and a valid WhatsApp recipient", () => {
    const conditions = buildWaitlistPromotedConditions({
      source: "waitlist",
      waitlistEntryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      reservationStatus: "reserved",
      sessionStatus: "scheduled",
      studentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recipient: "+5213312345678",
      contextComplete: true,
    });

    expect(conditions.every((condition) => condition.passed)).toBe(true);
  });
});
