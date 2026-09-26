import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-03 studio configuration", () => {
  const settingsPage = source("app/admin/configuracion/page.tsx");
  const settingsForm = source("app/admin/configuracion/OperatingPolicyForm.tsx");
  const settingsActions = source("app/admin/configuracion/actions.ts");
  const newActivityPage = source("app/admin/actividades/nueva/page.tsx");
  const activityWizard = source("app/admin/actividades/ActivityWizard.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const activityDetail = source("app/admin/actividades/[activityId]/page.tsx");
  const cancellationPage = source(
    "app/student/mis-clases/[reservationId]/cancelar/page.tsx",
  );
  const studentProfile = source("app/admin/alumnas/[studentId]/page.tsx");
  const studentActions = source("app/admin/alumnas/[studentId]/actions.ts");
  const migration = source(
    "supabase/migrations/20260926015552_dev_03a_operating_policy_and_penalties.sql",
  );

  it("stores operating defaults and unlimited penalties per studio", () => {
    expect(migration).toContain("default_minimum_reservations_enabled");
    expect(migration).toContain("default_minimum_reservations");
    expect(migration).toContain("default_minimum_review_minutes_before");
    expect(migration).toContain("unlimited_late_cancellation_penalty_minor");
    expect(migration).toContain("unlimited_no_show_penalty_minor");
    expect(settingsActions).toContain("owner_update_studio_operating_policy_v2");
    expect(settingsPage).toContain("default_minimum_reservations_enabled");
  });

  it("keeps Demeter's current five-hour and $20 unlimited rules", () => {
    expect(settingsPage).toContain("cancellation_cutoff_minutes");
    expect(migration).toContain("cancellation_cutoff_minutes := 300");
    expect(migration).toContain("unlimited_late_cancellation_penalty_minor=2000");
    expect(migration).toContain("unlimited_no_show_penalty_minor=2000");
  });

  it("lets new activities inherit studio defaults without changing existing activities", () => {
    expect(newActivityPage).toContain('from("studio_operating_policies")');
    expect(newActivityPage).toContain("operatingDefaults");
    expect(activityWizard).toContain("operatingDefaults?.minimumReservationsEnabled");
    expect(activityWizard).toContain("operatingDefaults?.minimumReviewMinutesBefore");
    expect(activityDetail).toContain("activity.allow_minimum_reservation_override");
    expect(activityActions).toContain("payload.allowMinimumReservationOverride");
  });

  it("creates a tenant-scoped charge only for unlimited late cancellation or no-show", () => {
    expect(migration).toContain("student_operating_charges");
    expect(migration).toContain("capture_unlimited_operating_charge");
    expect(migration).toContain("not coalesce(v_acquisition.unlimited,false)");
    expect(migration).toContain("new.status not in ('cancelled_late','no_show')");
    expect(migration).toContain("unique(reservation_id,charge_type)");
  });

  it("voids a pending no-show or late cancellation charge when the reservation is corrected", () => {
    expect(migration).toContain("status='voided'");
    expect(migration).toContain("Estado de reserva corregido");
  });

  it("shows the late cancellation penalty before the student confirms", () => {
    expect(cancellationPage).toContain("unlimited_penalty_minor");
    expect(cancellationPage).toContain("Esta cancelación genera una penalización");
    expect(cancellationPage).toContain("unlimitedPenaltyLabel");
  });

  it("surfaces pending charges to admin and supports paid or waived resolution", () => {
    expect(studentProfile).toContain('from("student_operating_charges")');
    expect(studentProfile).toContain("Marcar pagada");
    expect(studentProfile).toContain("Condonar");
    expect(studentActions).toContain("admin_resolve_student_operating_charge");
  });

  it("keeps operating charges isolated by tenant", () => {
    expect(migration).toContain("private.has_capability(studio_id,'sales.read')");
    expect(migration).toContain("private.is_current_student(student_id,studio_id)");
    expect(migration).toContain(
      "if not private.has_capability(v_charge.studio_id,'sales.write')",
    );
  });

  it("exposes clear settings for the owner instead of hardcoded Demeter values", () => {
    expect(settingsForm).toContain("Penalizaciones para paquetes ilimitados");
    expect(settingsForm).toContain("Activar por defecto en actividades nuevas");
    expect(settingsForm).toContain("Permitir “Impartir aunque no alcance”");
  });
});
