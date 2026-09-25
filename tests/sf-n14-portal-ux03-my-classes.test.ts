import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-03 Mis clases", () => {
  const list = source("app/student/mis-clases/page.tsx");
  const detail = source("app/student/mis-clases/[reservationId]/page.tsx");
  const cancel = source("app/student/mis-clases/[reservationId]/cancelar/page.tsx");
  const actions = source("app/student/actions.ts");
  const migration = source("supabase/migrations/20260919193000_n14_ux03_cancellation_preview.sql");

  it("separates upcoming reservations from history", () => {
    expect(list).toContain('href="/student/mis-clases"');
    expect(list).toContain('href="/student/mis-clases?view=history"');
    expect(list).toContain("Próximas");
    expect(list).toContain("Historial");
    expect(list).toContain('data-density="compact"');
  });

  it("prioritizes the next confirmed class before waitlist entries", () => {
    expect(list.indexOf("Tu próxima clase")).toBeLessThan(list.indexOf("Lista de espera"));
    expect(list).toContain("Después");
    expect(list).toContain("Confirmada");
    expect(list).not.toContain("showQuickCancel");
    expect(list).not.toContain("Prioridad Oro aplicada");
  });

  it("uses a dedicated reservation detail instead of the booking detail", () => {
    expect(list).toContain("/student/mis-clases/${item.reservation_id}");
    expect(detail).toContain("Tu reserva");
    expect(detail).toContain("/student/mis-clases/${item.reservation_id}/cancelar");
    expect(detail).not.toContain("/student/reservar/${item.session_id}");
  });

  it("shows check-in only from the reservation detail and keeps it contextual", () => {
    expect(detail).toContain("student_reservation_checkin_token");
    expect(detail).toContain("Haz tu check-in");
    expect(detail).toContain("Muéstralo al llegar");
    expect(list).not.toContain("ReservationCheckInQr");
  });

  it("requires confirmation and explains cancellation consequences before action", () => {
    expect(cancel).toContain("¿Seguro que quieres cancelar esta clase?");
    expect(cancel).toContain("Cancelar mi reserva");
    expect(cancel).toContain("Cancelar y perder");
    expect(cancel).toContain("Mantener mi reserva");
    expect(cancel).toContain("Puedes cancelar sin perder tu clase");
    expect(cancel).toContain("Estás cancelando tarde");
    expect(cancel).toContain('pendingLabel="Cancelando…"');
  });

  it("keeps cancellation access inside reservation detail rather than list cards", () => {
    expect(list).not.toContain("/student/mis-clases/${nextClass.reservation_id}/cancelar");
    expect(list).not.toContain("showQuickCancel");
    expect(detail).toContain("/student/mis-clases/${item.reservation_id}/cancelar");
    expect(cancel).toContain("student_cancellation_preview");
  });

  it("preserves reservation context after a temporary cancellation error", () => {
    expect(actions).toContain("/student/mis-clases/${reservationId}/cancelar?error=");
    expect(cancel).toContain("No se pudo procesar tu cancelación");
    expect(cancel).toContain("Tu reserva no se modificó. Puedes intentarlo de nuevo.");
    expect(cancel).toContain("Intentar de nuevo");
  });

  it("uses class language instead of credit language in student cancellation UX", () => {
    expect(cancel).toContain("perderás {classesAffected}");
    expect(cancel).toContain("Se devolverán {classesAffected}");
    expect(cancel).not.toContain("Studio Flow aplicará");
    expect(list).toContain("la clase fue devuelta a tu paquete");
    expect(detail).toContain("Clase devuelta");
  });

  it("does not duplicate the cancellation cutoff in the UX", () => {
    expect(list).not.toContain("8 horas");
    expect(detail).not.toContain("8 horas");
    expect(cancel).not.toContain("8 horas");
    expect(list).not.toContain("5 horas");
    expect(detail).not.toContain("5 horas");
    expect(cancel).not.toContain("5 horas");
  });

  it("keeps cancellation delegated to the canonical student RPC", () => {
    const block =
      actions
        .split("export async function cancelStudentReservationAction")[1]
        ?.split("export async function createMercadoPagoOrderAction")[0] ?? "";

    expect(cancel).toContain("cancelStudentReservationAction");
    expect(block).toContain('supabase.rpc("student_cancellation_preview"');
    expect(block).toContain('supabase.rpc("student_cancel_own_reservation"');
    expect(block).not.toContain("credit_ledger");
    expect(block).not.toContain("product_acquisitions");
  });

  it("shares one backend cancellation outcome rule between preview and mutation", () => {
    expect(migration).toContain("private.reservation_cancellation_outcome");
    expect(
      migration.match(/private\.reservation_cancellation_outcome/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("student_cancellation_preview");
  });

  it("supports success, stale-state, empty and retry states", () => {
    expect(list).toContain("Tu reserva fue actualizada");
    expect(list).toContain("La reserva ya cambió de estado");
    expect(list).toContain("No tienes clases próximas");
    expect(list).toContain("No pudimos cargar tus clases");
    expect(list).toContain("Reintentar");
  });
});
