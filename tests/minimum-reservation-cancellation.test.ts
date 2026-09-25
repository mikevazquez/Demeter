import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("CANCELACION-MIN-01 automatic minimum reservation cancellation", () => {
  const wizard = source("app/admin/actividades/ActivityWizard.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const sessionDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const sessionActions = source("app/admin/agenda/[sessionId]/actions.ts");
  const domainMigration = source(
    "supabase/migrations/20260922203000_cancelacion_minimo_reservas.sql",
  );
  const notificationMigration = source(
    "supabase/migrations/20260922210000_minimum_reservation_notifications.sql",
  );
  const recipientMigration = source(
    "supabase/migrations/20260922213000_minimum_notification_recipients.sql",
  );
  const studentList = source("app/student/reservar/page.tsx");
  const studentDetail = source("app/student/reservar/[sessionId]/page.tsx");
  const studentConfirm = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const coachProcessor = source("supabase/functions/process-session-minimum-cancelled/index.ts");

  it("configures the approved activity rule", () => {
    expect(wizard).toContain("Cancelación automática por mínimo de reservas");
    expect(wizard).toContain("Mínimo de reservas");
    expect(wizard).toContain("Revisar antes de la clase");
    expect(wizard).not.toContain("Permitir excepción por sesión");
    expect(activityActions).toContain("p_minimum_reservations_enabled");
    expect(activityActions).toContain("p_minimum_review_minutes_before");
  });

  it("evaluates a session once and stores the review result", () => {
    expect(domainMigration).toContain("minimum_review_status in");
    expect(domainMigration).toContain("'pending','met','cancelled','overridden'");
    expect(domainMigration).toContain("v_reserved_count >= v_session.minimum_reservations");
    expect(domainMigration).toContain("minimum_review_status = 'met'");
    expect(domainMigration).toContain("minimum_review_status = 'cancelled'");
    expect(domainMigration).toContain("minimum_review_status = 'pending'");
    expect(domainMigration).toContain("studio_flow_minimum_reservation_review");
  });

  it("cancels only the session and returns held credits without a late penalty", () => {
    expect(domainMigration).toContain("status = 'cancelled_by_studio'");
    expect(domainMigration).toContain(
      "Clase cancelada automáticamente: mínimo de reservas no alcanzado",
    );
    expect(domainMigration).toContain("greatest(coalesce(v_reservation.credits_held, 1), 1)");
    expect(domainMigration).toContain("'release'");
    expect(domainMigration).toContain("class_waitlist_entries");
  });

  it("supports the per-session exception", () => {
    expect(sessionDetail).toContain("Impartir aunque no alcance el mínimo");
    expect(sessionActions).toContain("admin_set_session_minimum_override");
    expect(domainMigration).toContain("minimum_review_status := 'overridden'");
  });

  it("shows capacity as student-centered availability in booking views", () => {
    for (const file of [studentList, studentDetail, studentConfirm]) {
      expect(file).toContain("session.spots_available");
      expect(file).toContain("lugares disponibles");
      expect(file).toContain("Último lugar");
      expect(file).toContain("Clase llena");
    }
  });

  it("creates in-app notices for reserved students and the assigned coach", () => {
    expect(notificationMigration).toContain("create table if not exists public.app_notifications");
    expect(notificationMigration).toContain("'session_minimum_cancelled'");
    expect(recipientMigration).toContain("'student'");
    expect(recipientMigration).toContain("'instructor'");
    expect(recipientMigration).toContain("v_session.instructor_id");
    expect(recipientMigration).toContain("No necesitas asistir");
  });

  it("routes the assigned coach cancellation through the Asistian channel", () => {
    expect(coachProcessor).toContain('const TEMPLATE = "class_cancelled_coach"');
    expect(coachProcessor).toContain("minimum_reservation_cancellation");
    expect(coachProcessor).toContain("La clase fue cancelada. No necesitas asistir.");
  });
});
