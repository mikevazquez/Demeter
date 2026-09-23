import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-04 Reservar", () => {
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const confirm = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const success = source("app/student/reservar/confirmacion/page.tsx");
  const actions = source("app/student/actions.ts");
  const portal = source("lib/student/portal.ts");

  it("uses date as the only reservation selector", () => {
    expect(reserve).toContain('aria-label="Seleccionar fecha"');
    expect(reserve).toContain("target_start: selectedDate");
    expect(reserve).toContain("target_end: selectedDate");
    expect(reserve).toContain("target_discipline_id: null");
    expect(reserve).not.toContain("Todas las disciplinas");
    expect(reserve).not.toContain("Todo el día");
    expect(reserve).not.toContain("target_discipline_id: query");
  });

  it("renders a compact chronological day schedule", () => {
    expect(reserve).toContain('data-density="compact"');
    expect(reserve).toContain("Clases del día");
    expect(reserve).toContain("No hay clases disponibles para esta fecha");
    expect(reserve).toContain("session.spots_available");
    expect(reserve).toContain("session.capacity");
  });

  it("shows canonical availability states and preserves quick booking", () => {
    expect(reserve).toContain("Ya reservada");
    expect(reserve).toContain("Disponible");
    expect(reserve).toContain('session.eligibility?.reason_code === "session_full"');
    expect(reserve).toContain("QuickBookButton");
  });

  it("keeps detail, confirmation, pending and success as separate steps", () => {
    expect(detail).toContain("Reservar clase");
    expect(detail).toContain("/confirmar?date=");
    expect(confirm).toContain("Revisa tu clase antes de confirmar");
    expect(confirm).toContain('pendingLabel="Reservando…"');
    expect(success).toContain("¡Clase reservada!");
    expect(success).toContain("Ver Mis clases");
  });

  it("preserves booking context after a temporary error", () => {
    expect(actions).toContain("/confirmar?error=");
    expect(confirm).toContain("No se pudo realizar la reserva");
    expect(confirm).toContain("Intentar de nuevo");
    expect(confirm).toContain('name="date"');
  });

  it("does not hardcode cancellation timing inside booking UX", () => {
    expect(detail).not.toContain("8 horas");
    expect(detail).not.toContain("5 horas");
    expect(confirm).not.toContain("8 horas");
    expect(confirm).not.toContain("5 horas");
  });

  it("covers the canonical non-eligible reasons surfaced by the booking engine", () => {
    expect(portal).toContain('payment_pending: "Tienes un pago pendiente que debes resolver"');
    expect(portal).toContain("No tienes créditos suficientes para reservar esta clase");
    expect(portal).toContain("Clase llena");
    expect(portal).toContain("Ya reservaste esta clase");
    expect(portal).toContain('document_required: "Tienes un documento pendiente"');
    expect(portal).toContain('guardian_required: "Tu responsable debe completar un documento"');
  });
});
