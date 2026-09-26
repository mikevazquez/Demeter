import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-02 conversion event intelligence", () => {
  const adminActions = source("app/admin/actions.ts");
  const adminRoster = source("app/admin/hoy/SessionOperations.tsx");
  const studentCancel = source("app/student/mis-clases/[reservationId]/cancelar/page.tsx");
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("requires structured cancellation reasons in admin and student flows", () => {
    expect(adminActions).toContain("CANCELLATION_REASON_CODES");
    expect(adminActions).toContain('target_reason: reason');
    expect(adminActions).toContain('supabase.rpc("cancel_reservation"');
    expect(adminRoster).toContain('name="reason"');
    expect(adminRoster).toContain('value="schedule_conflict"');
    expect(studentCancel).toContain('name="reason"');
    expect(studentCancel).toContain('required');
    expect(studentCancel).toContain('value="prefer_not_say"');
  });

  it("builds conversion intelligence from immutable domain events", () => {
    expect(intelligence).toContain('.from("domain_events")');
    expect(intelligence).toContain('"booking.created"');
    expect(intelligence).toContain('"booking.cancelled"');
    expect(intelligence).toContain('"attendance.finalized"');
    expect(intelligence).toContain("recoveryStats");
    expect(intelligence).toContain("acquisitionCohortStats");
    expect(intelligence).toContain("Actividad sirve para operación; cohorte sirve para medir conversión.");
  });

  it("keeps studio cancellations out of the customer cancellation funnel", () => {
    expect(intelligence).toContain('!== "cancelled_by_studio"');
    expect(intelligence).toContain('=== "cancelled_by_studio"');
    expect(intelligence).toContain("Canceladas por el estudio");
  });

  it("keeps missing and Asistian cancellation reasons visible instead of dropping them", () => {
    expect(intelligence).toContain("Sin motivo registrado");
    expect(intelligence).toContain("Sin motivo informado · Asistian");
    expect(intelligence).toContain("Otro / histórico");
  });
  it("uses package or membership purchase as the commercial conversion signal", () => {
    expect(intelligence).toContain('conversionProductTypes = new Set(["package", "membership"])');
    expect(intelligence).toContain("firstConversionAcquisitionByStudent");
    expect(intelligence).toContain("Compraron paquete / membresía");
  });

  it("uses effective payment dates and keeps collections independent from report period", () => {
    expect(intelligence).toContain("paymentEffectiveDateTime");
    expect(intelligence).toContain("paymentDateKey");
    expect(intelligence).toContain("collectionOpenRows");
    expect(intelligence).toContain("Cobranza vencida");
    expect(intelligence).toContain("Saldos de cobranza abiertos");
  });

  it("detects retention risk before expiration with explainable signals", () => {
    expect(intelligence).toContain("preventiveRiskStudents");
    expect(intelligence).toContain("sin próxima reserva");
    expect(intelligence).toContain("14 días sin asistir");
    expect(intelligence).toContain("Riesgo preventivo");
  });

  it("requires meaningful class samples before suggesting operational changes", () => {
    expect(intelligence).toContain("row.sessionCount >= 3");
    expect(intelligence).toContain("row.total >= 5");
    expect(intelligence).toContain("Evaluar expansión");
    expect(intelligence).toContain("Investigar cancelaciones");
    expect(intelligence).toContain("Reducir no show");
  });

});
