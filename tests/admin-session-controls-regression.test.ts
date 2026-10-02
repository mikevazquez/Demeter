import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Admin session controls regression", () => {
  const today = source("app/admin/page.tsx");
  const todayOperations = source("app/admin/hoy/SessionOperations.tsx");
  const paymentDialog = source("app/admin/hoy/PendingClassPaymentDialog.tsx");
  const adminActions = source("app/admin/actions.ts");
  const agenda = source("app/admin/agenda/page.tsx");
  const sessionDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const rosterStyles = source("app/admin/roster-uat.css");

  it("resolves reserved trial student names independently from the active-student directory", () => {
    expect(today).toContain("reservationStudentIds");
    expect(today).toContain("reservationStudents");
    expect(today).toContain('.in("id", reservationStudentIds)');
    expect(today).toContain("(reservationStudents ?? []).map");
    expect(sessionDetail).toContain("reservationStudentIds");
    expect(sessionDetail).toContain("(reservationStudents ?? []).map");
  });

  it("keeps reserved student names visible on the light Today roster", () => {
    expect(todayOperations).toContain("<strong>{item.studentName}</strong>");
    expect(rosterStyles).toContain(".hoy-approved .today-student-name-line strong");
    expect(rosterStyles).toContain("color: #172033");
  });

  it("restores pending-payment data from Today", () => {
    expect(today).toContain("commercial_status");
    expect(today).toContain("drop_in_price_minor");
    expect(today).toContain(
      'paymentDueOnAttendance: reservation.commercial_status === "payment_pending"',
    );
    expect(today).toContain("individualPriceMinor: template?.drop_in_price_minor ?? null");
  });

  it("requires payment capture before attendance for a pending trial reservation", () => {
    expect(todayOperations).toContain("PendingClassPaymentDialog");
    expect(todayOperations).toContain("Pago pendiente");
    expect(todayOperations).toContain("setPaymentItem(item)");
    expect(todayOperations).toContain("paymentDueOnAttendance && item.status !==");
    expect(paymentDialog).toContain("Registrar pago y asistencia");
    expect(paymentDialog).toContain('<option value="efectivo">Efectivo</option>');
    expect(paymentDialog).toContain('<option value="transferencia">Transferencia</option>');
    expect(paymentDialog).toContain('<option value="tarjeta">Tarjeta</option>');
    expect(adminActions).toContain("recordPendingClassPaymentAndAttendanceFromToday");
    expect(adminActions).toContain('rpc("record_asistian_class_payment_and_attendance"');
  });

  it("keeps session editing available directly from Agenda", () => {
    expect(agenda).toContain("href={`/admin/agenda?date=${key}&session=${session.id}`}");
    expect(agenda).toContain('className="agenda-session-editor"');
    expect(agenda).toContain("<small>EDITAR SESIÓN</small>");
    expect(agenda).toContain("action={updateSession}");
    expect(agenda).toContain("Guardar cambios");
    expect(agenda).toContain("Solo esta sesión");
    expect(agenda).toContain("Esta y siguientes");
  });
});
