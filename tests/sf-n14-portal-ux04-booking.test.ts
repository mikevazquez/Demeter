import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-04 Reservar", () => {
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const resource = source("app/student/reservar/[sessionId]/recurso/page.tsx");
  const resourcePicker = source("app/student/reservar/[sessionId]/recurso/ResourcePicker.tsx");
  const confirm = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const success = source("app/student/reservar/confirmacion/page.tsx");
  const actions = source("app/student/actions.ts");
  const portal = source("lib/student/portal.ts");

  it("uses day plus an optional discipline chip as the schedule selectors", () => {
    expect(reserve).toContain('aria-label="Seleccionar fecha"');
    expect(reserve).toContain('aria-label="Filtrar por disciplina"');
    expect(reserve).toContain("target_start: selectedDate");
    expect(reserve).toContain("target_end: selectedDate");
    expect(reserve).toContain("target_discipline_id: selectedDiscipline");
    expect(reserve).not.toContain("Todo el día");
  });

  it("renders a visual chronological schedule with student-centered availability", () => {
    expect(reserve).toContain('data-density="visual"');
    expect(reserve).toContain("Clases del día");
    expect(reserve).toContain("No hay clases disponibles para esta fecha");
    expect(reserve).toContain("lugares disponibles");
    expect(reserve).toContain("Último lugar");
    expect(reserve).toContain("Clase llena");
  });

  it("uses choose-class then detail instead of inline quick booking", () => {
    expect(reserve).toContain("Reservada ✓");
    expect(reserve).toContain("Reservar →");
    expect(reserve).not.toContain("QuickBookButton");
    expect(reserve).not.toContain("PurchaseSingleClassButton");
    expect(detail).toContain("Reservar esta clase");
    expect(detail).toContain("/confirmar?date=");
  });

  it("keeps detail, optional place selection, confirmation and success as separate steps", () => {
    expect(detail).toContain("Elegir mi lugar");
    expect(resource).toContain("Elige tu lugar");
    expect(resourcePicker).toContain("resourceNoun");
    expect(confirm).toContain("Confirma tu clase");
    expect(confirm).toContain('pendingLabel="Reservando…"');
    expect(success).toContain("¡Listo! Tu lugar está reservado");
    expect(success).toContain("Ver mi clase");
  });

  it("keeps waitlist mechanics hidden behind human copy", () => {
    const waitlistControl = source("app/student/reservar/WaitlistControl.tsx");

    expect(detail).toContain("Si se libera un lugar, te avisaremos según el orden");
    expect(waitlistControl).toContain("Te avisaremos si se libera un lugar.");
    expect(waitlistControl).not.toContain("Prioridad Oro aplicada");
    expect(waitlistControl).not.toContain("levelTitle");
  });

  it("preserves booking context after a temporary error", () => {
    expect(actions).toContain("/confirmar?error=");
    expect(confirm).toContain("No se pudo realizar la reserva");
    expect(confirm).toContain("Intentar de nuevo");
    expect(confirm).toContain('name="date"');
  });

  it("does not expose internal product or Studio Flow language in booking UI", () => {
    expect(reserve).not.toContain("saldo premio");
    expect(detail).not.toContain("Studio Flow");
    expect(success).not.toContain("Studio Flow");
    expect(detail).not.toContain("crédito(s)");
    expect(portal).toContain("No tienes clases suficientes para reservar esta clase");
  });

  it("covers the canonical non-eligible reasons surfaced by the booking engine", () => {
    expect(portal).toContain('payment_pending: "Tienes un pago pendiente que debes resolver"');
    expect(portal).toContain("Clase llena");
    expect(portal).toContain("Ya reservaste esta clase");
    expect(portal).toContain('document_required: "Tienes un documento pendiente"');
    expect(portal).toContain('guardian_required: "Tu responsable debe completar un documento"');
  });
});
