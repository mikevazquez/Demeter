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
import { triggerReservationConfirmedAutomation } from "../lib/automations/reservation-confirmed-client";

describe("SF-175 reservation confirmed", () => {
  it("builds the approved reservation variables in the studio timezone", () => {
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

    expect(conditions.find((condition) => condition.key === "reservation.valid")?.passed).toBe(
      true,
    );
    expect(conditions.find((condition) => condition.key === "student.identified")?.passed).toBe(
      true,
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
      responseSnapshot: { mock: true, delivery_number: 1 },
    });

    expect(provider.deliveries).toHaveLength(1);
  });

  it("forwards the authenticated access token to the Edge Function", async () => {
    let authorization: string | undefined;

    const client = {
      auth: {
        async getSession() {
          return {
            data: { session: { access_token: "uat-access-token" } },
            error: null,
          };
        },
      },
      functions: {
        async invoke<T>(
          _functionName: string,
          options: {
            body: Record<string, unknown>;
            headers?: Record<string, string>;
          },
        ) {
          authorization = options.headers?.Authorization;
          return {
            data: { ok: true } as T,
            error: null,
          };
        },
      },
    };

    await expect(triggerReservationConfirmedAutomation(client, "reservation-123")).resolves.toBe(
      true,
    );

    expect(authorization).toBe("Bearer uat-access-token");
  });

  it("keeps automation delivery non-blocking for a successful booking", async () => {
    const client = {
      auth: {
        async getSession() {
          return {
            data: { session: { access_token: "uat-access-token" } },
            error: null,
          };
        },
      },
      functions: {
        async invoke<T>() {
          return {
            data: null as T | null,
            error: { message: "temporary automation failure" },
          };
        },
      },
    };

    await expect(triggerReservationConfirmedAutomation(client, "reservation-123")).resolves.toBe(
      false,
    );
  });

  it("emits booking.created only after the reservation insert", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919153000_sf175_reservation_confirmed.sql"),
      "utf8",
    );

    const reservationInsert = migration.indexOf("insert into public.reservations");
    const eventEmit = migration.indexOf("perform public.emit_domain_event");

    expect(reservationInsert).toBeGreaterThan(-1);
    expect(eventEmit).toBeGreaterThan(reservationInsert);
    expect(migration).toContain("'booking.created'");
    expect(migration).toContain("'booking.created:' || v_reservation_id::text");
  });

  it("connects every existing booking entry point to the same processor", () => {
    const files = [
      "app/student/actions.ts",
      "app/admin/agenda/[sessionId]/actions.ts",
      "app/admin/alumnas/[studentId]/reservar/actions.ts",
    ];

    for (const path of files) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).toContain("triggerReservationConfirmedAutomation");
    }
  });

  it("keeps the processor on SF-165, SF-166 and the mock provider contract", () => {
    const source = readFileSync(
      join(process.cwd(), "supabase/functions/process-booking-created/index.ts"),
      "utf8",
    );

    expect(source).toContain("record_automation_eligibility_evaluation");
    expect(source).toContain("system_create_automation_execution");
    expect(source).toContain("system_start_automation_execution_attempt");
    expect(source).toContain("system_mark_automation_execution_sent");
    expect(source).toContain("system_mark_automation_execution_accepted");
    expect(source).toContain("MockMessagingProvider");
    expect(source).toContain("context.supabaseAdmin");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("createClient(supabaseUrl, serviceRoleKey");
    expect(source).not.toContain("ASISTIAN_");
  });
});
