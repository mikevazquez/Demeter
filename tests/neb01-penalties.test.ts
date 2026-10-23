import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bookingWindowCopy } from "../lib/booking-windows";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-41 penalizaciones para alumnas regulares", () => {
  const migration = read("supabase/migrations/20261022218000_neb01_student_penalties.sql");

  it("todo apagado por defecto y por separado para faltas y cancelaciones tardías", () => {
    expect(migration).toContain("package_late_cancellation_penalty_minor integer not null default 0");
    expect(migration).toContain("package_no_show_penalty_minor integer not null default 0");
    expect(migration).toContain("add column if not exists no_show_block_threshold integer,");
    expect(migration).toContain("add column if not exists late_cancel_block_threshold integer,");
  });

  it("la pausa y el adeudo frenan a la alumna y a Demi, no al equipo ni a la lista de espera", () => {
    expect(migration).toContain("before insert on public.reservations");
    expect(migration).toContain("before insert on public.class_waitlist_entries");
    expect(migration).toContain("private.booking_window_applies(new.studio_id)");
    expect(migration).toContain("'student_booking_blocked'");
    expect(migration).toContain("'student_charge_pending'");
  });

  it("no se enciman pausas ni se cuentan dos veces los mismos eventos", () => {
    expect(migration).toContain("Ya hay una pausa vigente del mismo tipo");
    expect(migration).toContain("Solo cuentan eventos posteriores a la última pausa");
  });

  it("el cargo en paquetes usa la misma función que ya cobra a ilimitados", () => {
    expect(migration).toContain("else v_policy.package_late_cancellation_penalty_minor end;");
    expect(migration).toContain("else v_policy.package_no_show_penalty_minor end;");
  });

  it("la alumna ve por qué no puede reservar", () => {
    expect(bookingWindowCopy("student_charge_pending", null, "America/Mexico_City")).toBe(
      "Tienes un adeudo pendiente",
    );
    expect(
      bookingWindowCopy("student_booking_blocked", "2026-11-12T02:00:00Z", "America/Mexico_City"),
    ).toMatch(/^Reservas en pausa hasta /);
    expect(read("app/student/actions.ts")).toContain('"student_booking_blocked"');
    expect(read("app/student/reservar/quick-book-button.tsx")).toContain("student_charge_pending");
  });

  it("recepción puede quitar la pausa y resolver el cargo desde la ficha", () => {
    const actions = read("app/admin/alumnas/[studentId]/penalty-actions.ts");
    expect(actions).toContain('rpc("admin_waive_student_booking_penalty"');
    expect(actions).toContain('rpc("admin_resolve_student_operating_charge"');
    expect(read("app/admin/alumnas/[studentId]/page.tsx")).toContain("<StudentPenaltiesPanel");
  });
});
