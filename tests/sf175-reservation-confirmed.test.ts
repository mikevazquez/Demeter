import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReservationConfirmedConditions,
  buildReservationConfirmedVariables,
  MockMessagingProvider,
  reservationConfirmedCandidateKey,
  reservationConfirmedIdempotencyKey,
  RESERVATION_CONFIRMED_TEMPLATE,
} from "../supabase/functions/process-booking-created/reservation-confirmed";

describe("SF-175 reservation confirmed · domain dispatch", () => {
  it("builds reservation variables in the studio timezone", () => {
    expect(
      buildReservationConfirmedVariables({
        studentName: "Ana Pérez",
        discipline: "Pole Fitness",
        startsAt: "2026-09-20T01:30:00.000Z",
        timeZone: "America/Mexico_City",
        coach: "Coach Demo",
        location: "Demeter · Sala 1",
        creditsRemaining: 6,
      }),
    ).toEqual({
      nombre: "Ana Pérez",
      disciplina: "Pole Fitness",
      fecha: "19/09/2026",
      hora: "19:30",
      coach: "Coach Demo",
      ubicacion: "Demeter · Sala 1",
      creditos_restantes: 6,
    });
  });

  it("treats an invalid WhatsApp number as an eligibility exclusion", () => {
    const conditions = buildReservationConfirmedConditions({
      reservationStatus: "reserved",
      sessionStatus: "scheduled",
      studentId: "student-1",
      recipient: "331234",
      contextComplete: true,
    });

    expect(conditions).toContainEqual(
      expect.objectContaining({
        key: "channel.available",
        passed: false,
        reason_code: "whatsapp_contact_invalid",
      }),
    );
  });

  it("uses stable reservation-scoped candidate and idempotency keys", () => {
    expect(reservationConfirmedCandidateKey("reservation-123")).toBe("reservation:reservation-123");
    expect(reservationConfirmedIdempotencyKey("reservation-123")).toBe(
      "sf175:reservation:reservation-123",
    );
  });

  it("delivers through the mock provider without Asistian", async () => {
    const provider = new MockMessagingProvider();

    await expect(
      provider.send({
        recipient: "+523312345678",
        template: RESERVATION_CONFIRMED_TEMPLATE,
        variables: { nombre: "Ana" },
        executionId: "execution-1",
        metadata: { catalog_code: "AUT-CAT-01" },
      }),
    ).resolves.toMatchObject({
      status: "accepted",
      providerReference: "mock:execution-1:1",
    });
  });

  it("emits booking.created only after the direct reservation insert", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921035000_sf175_domain_dispatch.sql"),
      "utf8",
    );

    const reservationInsert = migration.indexOf("insert into public.reservations");
    const eventEmit = migration.indexOf("perform public.emit_domain_event");

    expect(reservationInsert).toBeGreaterThan(-1);
    expect(eventEmit).toBeGreaterThan(reservationInsert);
    expect(migration).toContain("'booking.created'");
    expect(migration).toContain("'booking.created:' || v_reservation_id::text");
  });

  it("dispatches booking.created from the domain event instead of UI call sites", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921035000_sf175_domain_dispatch.sql"),
      "utf8",
    );

    expect(migration).toContain("after insert on public.domain_events");
    expect(migration).toContain("when (new.event_type = 'booking.created')");
    expect(migration).toContain("private.dispatch_booking_created_event_id(new.event_id)");
    expect(migration).toContain("net.http_post(");
    expect(migration).toContain("'eventId', p_event_id");
  });

  it("keeps waitlist promotions on the same booking.created contract", () => {
    const waitlist = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921004500_sf255_waitlist_priority.sql"),
      "utf8",
    );

    expect(waitlist).toContain("private.waitlist_book_student");
    expect(waitlist).toContain("'booking.created'");
    expect(waitlist).toContain("'source', 'waitlist'");
  });

  it("authenticates internal dispatch with a Vault-backed token", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921035000_sf175_domain_dispatch.sql"),
      "utf8",
    );
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/process-booking-created/index.ts"),
      "utf8",
    );

    expect(migration).toContain("studio_flow_automation_dispatch_token");
    expect(migration).toContain("verify_automation_dispatch_token");
    expect(source).toContain('withSupabase({ auth: "none" }');
    expect(source).toContain('request.headers.get("x-studio-flow-dispatch-token")');
    expect(source).toContain('"verify_automation_dispatch_token"');
    expect(source).toContain("context.supabaseAdmin");
    expect(source).not.toContain("context.userClaims");
  });

  it("processes an event id and preserves execution idempotency", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/process-booking-created/index.ts"),
      "utf8",
    );

    expect(source).toContain("payload.eventId");
    expect(source).toContain('.eq("event_id", eventId)');
    expect(source).toContain('dispatchEvent.event_type !== "booking.created"');
    expect(source).toContain("record_automation_eligibility_evaluation");
    expect(source).toContain("system_create_automation_execution");
    expect(source).toContain("system_start_automation_execution_attempt");
    expect(source).toContain("system_mark_automation_execution_accepted");
    expect(source).toContain("domain_event_claim_failed");
    expect(source).toContain("MockMessagingProvider");
  });

  it("uses custom function authentication rather than gateway JWT auth", () => {
    const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");
    expect(config).toContain("[functions.process-booking-created]\nverify_jwt = false");
  });
});
