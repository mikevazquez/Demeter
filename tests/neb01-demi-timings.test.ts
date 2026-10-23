import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-37 tiempos de recordatorios de Demi", () => {
  const migration = read("supabase/migrations/20261022220000_neb01_demi_reminder_timings.sql");

  it("arranca con los tiempos que Demeter usa hoy", () => {
    expect(migration).toContain("payment_reminder_hours integer[] not null default '{2,6}'");
    expect(migration).toContain("package_reminder_days integer[] not null default '{7,15,30}'");
    expect(migration).toContain("inactive_reminder_days integer not null default 14");
    expect(migration).toContain("package_expiring_days_before integer not null default 3");
    expect(migration).toContain("trial_payment_hold_minutes integer not null default 30");
  });

  it("el programador de recordatorios y el apartado usan la configuración", () => {
    expect(migration).toContain(
      "public.service_schedule_demi_followups(uuid,uuid,text,text,timestamp with time zone)",
    );
    expect(migration).toContain("raise exception 'NEB-01: definición inesperada");
    expect(migration).toContain("s.trial_payment_hold_minutes");
  });

  it("el dueño los edita en Demi › Seguimientos", () => {
    const page = read("app/admin/mas/demi/seguimientos/page.tsx");
    expect(page).toContain('rpc("admin_save_demi_reminder_timings"');
    expect(page).not.toContain("a los 7, 15 y 30 días y detecta 14 días");
  });
});
