import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Asistian pending payment attendance", () => {
  it("marks pending Asistian reservations in the admin roster", () => {
    const today = source("app/admin/page.tsx");
    const detail = source("app/admin/agenda/[sessionId]/page.tsx");

    expect(today).toContain("commercial_status");
    expect(today).toContain('reservation.commercial_status === "payment_pending"');
    expect(today).toContain("drop_in_price_minor");
    expect(detail).toContain('reservation.commercial_status === "payment_pending"');
    expect(detail).toContain("drop_in_price_minor");
  });

  it("asks for payment before attendance and keeps no-show unchanged", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");
    const dialog = source("app/admin/hoy/PendingClassPaymentDialog.tsx");

    expect(operations).toContain("paymentDueOnAttendance");
    expect(operations).toContain("Pago pendiente");
    expect(operations).toContain("setPaymentItem(item)");
    expect(dialog).toContain("¿Cómo pagó?");
    expect(dialog).toContain('<option value="efectivo">Efectivo</option>');
    expect(dialog).toContain('<option value="transferencia">Transferencia</option>');
    expect(dialog).toContain('<option value="tarjeta">Tarjeta</option>');
    expect(dialog).toContain('<option value="otro">Otro</option>');
    expect(dialog).toContain("Registrar pago y asistencia");
  });

  it("records sale, payment and attendance atomically in the database", () => {
    const migration = source("supabase/migrations/20260926002754_asistian_attendance_payment.sql");

    expect(migration).toContain("record_asistian_class_payment_and_attendance");
    expect(migration).toContain("payments_reservation_direct_payment_unique");
    expect(migration).toContain("reservation_id");
    expect(migration).toContain("insert into public.sales");
    expect(migration).toContain("insert into public.payments");
    expect(migration).toContain("commercial_status = 'paid'");
    expect(migration).toContain("status = 'attended'");
    expect(migration).toContain("walkin.commercial_resolved");
  });

  it("blocks bypassing the payment through another attendance path", () => {
    const migration = source("supabase/migrations/20260926002754_asistian_attendance_payment.sql");
    const actions = source("app/admin/actions.ts");

    expect(migration).toContain("enforce_asistian_payment_before_attendance");
    expect(migration).toContain("asistian_payment_required");
    expect(actions).toContain('supabase.rpc("record_asistian_class_payment_and_attendance"');
    expect(actions).toContain('"paid-attendance"');
  });
});
