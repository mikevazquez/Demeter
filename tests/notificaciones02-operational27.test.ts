import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("NOTIFICACIONES-02 operational catalog 27", () => {
  const catalog = source("lib/notifications/admin-catalog.ts");
  const migration = source(
    "supabase/migrations/20260924193000_notificaciones02_operational_catalog_27.sql",
  );

  const processSection = catalog.slice(
    catalog.indexOf("export const NOTIFICATION_PROCESSES"),
    catalog.indexOf("export type MarketingDefinition"),
  );

  it("exposes exactly the 27 approved operational processes with no placeholders", () => {
    expect(processSection.match(/\n    key: "/g)?.length).toBe(27);
    expect(processSection).not.toContain("planned: true");

    for (const name of [
      "Reserva confirmada",
      "Reserva modificada",
      "Reserva cancelada por alumna",
      "Recordatorio de clase",
      "Cancelación tardía",
      "No show",
      "Clase cancelada por el estudio",
      "Cancelación por mínimo de reservas",
      "Cambio de horario / sesión",
      "Lugar disponible en lista de espera",
      "Lugar de lista de espera vencido",
      "Paquete comprado o activado",
      "Paquete próximo a vencer",
      "Paquete vencido",
      "Crédito restaurado",
      "Pago pendiente",
      "Pago confirmado",
      "Invitación a evaluación",
      "Recordatorio de evaluación",
      "Resultado de evaluación",
      "Documentos pendientes",
      "Nueva versión de documento",
      "Firma del responsable pendiente",
      "Cuenta creada / bienvenida",
      "Restablecimiento de contraseña",
      "Cambio de coach",
      "Cierre extraordinario / día festivo",
    ]) {
      expect(processSection).toContain(name);
    }
  });

  it("connects every process to at least one real central-engine rule", () => {
    expect(processSection).not.toMatch(/ruleKeys:\s*\[\s*\]/);

    for (const ruleKey of [
      "p0.booking.confirmed",
      "p0.booking.modified",
      "p0.booking.cancelled_by_student",
      "p0.booking.class_reminder_5h",
      "p0.booking.cancelled_late",
      "p0.attendance.no_show",
      "p0.session.cancelled_by_studio",
      "p0.session.minimum_cancelled_students",
      "p0.session.rescheduled_notice",
      "p0.booking.waitlist_promoted",
      "p0.waitlist.expired",
      "p0.package.activated",
      "p0.package.expiring",
      "p0.package.expired",
      "p0.credit.restored",
      "p0.payment.pending",
      "p0.payment.confirmed",
      "p0.evaluation.invitation",
      "p0.evaluation.reminder",
      "p0.evaluation.completed",
      "p0.documents.pending",
      "p0.document.new_version",
      "p0.guardian.signature_pending",
      "p0.account.created",
      "p0.password.reset",
      "p0.session.coach_changed",
      "p0.studio.closure",
    ]) {
      expect(processSection).toContain(ruleKey);
    }
  });

  it("adds real producers for previously missing operational events", () => {
    for (const eventType of [
      "booking.updated",
      "session.cancelled_by_studio",
      "waitlist.expired",
      "account.created",
      "account.password_reset",
      "documents.guardian_signature_pending",
      "document.new_version",
      "session.coach_changed",
      "studio.closure_affected",
      "package.expiring_due",
      "package.expired_due",
      "evaluation.reminder_due",
      "documents.pending",
    ]) {
      expect(migration).toContain(eventType);
    }

    expect(migration).toContain("notification_emit_due_operational_events");
    expect(migration).toContain("studio_flow_notification_operational_due");
    expect(migration).toContain("'0 * * * *'");
  });

  it("retires the old generic cancellation rule to avoid duplicate delivery", () => {
    expect(migration).toContain("where rule_key = 'p0.booking.cancelled'");
    expect(migration).toContain("set enabled = false");
  });

  it("enforces essential processes in the backend", () => {
    expect(migration).toContain("p0.session.minimum_cancelled_students");
    expect(migration).toContain("p0.session.minimum_cancelled_coach");
    expect(migration).toContain("p0.password.reset");
    expect(migration).toContain("p0.studio.closure");
    expect(migration).toContain("notification_process_essential");
  });
});
