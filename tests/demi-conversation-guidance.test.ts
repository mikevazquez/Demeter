import { describe, expect, it } from "vitest";
import { conversationGuidance } from "../lib/assistant/conversation-guidance";

describe("Demi conversation guidance for UAT rules", () => {
  it("does not request prospect identity or prepare a booking before payment proof", () => {
    const guidance = conversationGuidance({ testSimulation: { persona: "prospect" } });

    expect(guidance).toContain("No pidas nombre, celular ni datos de acompañantes");
    expect(guidance).toContain("antes de recibir el comprobante");
    expect(guidance).toContain("Recibir el comprobante no significa que el pago esté validado");
    expect(guidance).toContain("No llames a prepare_booking para una prospecta con pago previo");
    expect(guidance).toContain("ni digas que estás confirmando o apartando una reserva");
  });

  it("checks former-student enrollment and lets an active package finish", () => {
    const guidance = conversationGuidance({
      testSimulation: { persona: "former_student" },
    });

    expect(guidance).toContain("consulta get_student_package_status antes de responder");
    expect(guidance).toContain("Si tiene un paquete vigente con créditos, puede terminar de usarlo");
    expect(guidance).toContain("exige renovar la inscripción antes de una reserva nueva");
  });
});
