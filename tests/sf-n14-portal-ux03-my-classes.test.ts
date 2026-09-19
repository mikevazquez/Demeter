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

  it("separates upcoming reservations from history", () => {
    expect(list).toContain('href="/student/mis-clases"');
    expect(list).toContain('href="/student/mis-clases?view=history"');
    expect(list).toContain("Próximas");
    expect(list).toContain("Historial");
    expect(list).toContain('data-density="compact"');
  });

  it("uses a dedicated reservation detail instead of the booking detail", () => {
    expect(list).toContain("/student/mis-clases/${item.reservation_id}");
    expect(detail).toContain("Gestionar reserva");
    expect(detail).toContain("/student/mis-clases/${item.reservation_id}/cancelar");
    expect(detail).not.toContain("/student/reservar/${item.session_id}");
  });

  it("requires confirmation and exposes pending cancellation feedback", () => {
    expect(cancel).toContain("¿Seguro que quieres cancelar esta clase?");
    expect(cancel).toContain("Sí, cancelar");
    expect(cancel).toContain("No, mantener");
    expect(cancel).toContain('pendingLabel="Cancelando…"');
    expect(cancel).toContain("PendingActionButton");
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
    expect(block).toContain('supabase.rpc("student_cancel_own_reservation"');
    expect(block).not.toContain("credit_ledger");
    expect(block).not.toContain("product_acquisitions");
  });

  it("supports success, error, empty and retry states", () => {
    expect(list).toContain("Tu reserva fue actualizada");
    expect(list).toContain("Esta clase ya no se puede cancelar");
    expect(list).toContain("No tienes clases próximas");
    expect(list).toContain("No pudimos cargar tus clases");
    expect(list).toContain("Reintentar");
  });
});
