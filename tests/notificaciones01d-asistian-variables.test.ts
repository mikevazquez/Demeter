import { describe, expect, it } from "vitest";

import { buildAsistianVariables } from "../supabase/functions/_shared/notification-asistian-variables";

const base = {
  recipient_name: "Mike",
  class_name: "Exotic Pole",
  discipline_name: "Pole Fitness",
  session_starts_at: "2026-09-27T21:00:00.000Z",
  studio_timezone: "America/Mexico_City",
};

describe("NOTIFICACIONES-01D Assistian variable mapping", () => {
  it("maps transactional class variables to the legacy Assistian contract", () => {
    expect(
      buildAsistianVariables("reservation_confirmed", {
        ...base,
        coach: "Coach Demo",
        location: "Salón A",
        credits_remaining: 4,
      }),
    ).toEqual({
      nombre: "Mike",
      disciplina: "Pole Fitness",
      fecha: "27/09/2026",
      hora: "15:00",
      coach: "Coach Demo",
      ubicacion: "Salón A",
      creditos_restantes: 4,
    });
  });

  it("maps cancellation status without losing the legacy semantic fields", () => {
    expect(
      buildAsistianVariables("reservation_cancelled", {
        ...base,
        to_status: "cancelled_late",
        credits_remaining: 3,
      }),
    ).toEqual({
      clase: "Exotic Pole",
      fecha: "27/09/2026",
      hora: "15:00",
      tipo_cancelacion: "Tardía",
      credito_recuperado: false,
      creditos_restantes: 3,
    });
  });

  it("maps minimum-cancellation coach variables", () => {
    expect(
      buildAsistianVariables("class_cancelled_coach", {
        ...base,
        recipient_name: "Coach Demo",
        minimum_required: 2,
        reservations_at_review: 1,
      }),
    ).toEqual({
      coach: "Coach Demo",
      clase: "Exotic Pole",
      fecha: "27/09/2026",
      hora: "15:00",
      minimo_reservas: 2,
      reservas_al_revisar: 1,
      mensaje: "La clase fue cancelada. No necesitas asistir.",
    });
  });

  it("passes through unknown templates so future adapters can extend safely", () => {
    const variables = { foo: "bar" };
    expect(buildAsistianVariables("future_template", variables)).toBe(variables);
  });
});
