import { describe, expect, it } from "vitest";
import { conversationGuidance } from "../lib/assistant/conversation-guidance";

describe("Demi conversation guidance for UAT rules", () => {
  it("blocks a second trial booking when a trial reservation already exists", () => {
    const guidance = conversationGuidance({
      studentCategory: "trial_pending",
      testSimulation: { persona: "trial_pending_reserved" },
    });
    expect(guidance).toContain("consulta get_student_reservations");
    expect(guidance).toContain("no ofrezcas otra reserva ni otro pago");
  });

  it("does not request prospect identity or prepare a booking before payment proof", () => {
    const guidance = conversationGuidance({ testSimulation: { persona: "prospect" } });

    expect(guidance).toContain("No pidas nombre ni datos completos de acompañantes");
    expect(guidance).toContain("antes de recibir el comprobante");
    expect(guidance).toContain("Recibir el comprobante no significa que el pago esté validado");
    expect(guidance).toContain("No llames a prepare_booking para una prospecta con pago previo");
    expect(guidance).toContain("ni digas que estás confirmando o apartando una reserva");
  });

  it("reuses the WhatsApp prospect identity and never asks for the sender phone again", () => {
    const guidance = conversationGuidance({ channel: "whatsapp", crmContactId: "crm-prospect-id" });

    expect(guidance).toContain("Studio Flow ya buscó este número de WhatsApp");
    expect(guidance).toContain("nunca vuelvas a pedirle su celular");
    expect(guidance).toContain("solicita únicamente el nombre completo u otro dato que realmente falte");
    expect(guidance).toContain("no digas que el portal, la compra o el pago quedaron hechos");
  });

  it("requires enrollment renewal while preserving active package credits", () => {
    const guidance = conversationGuidance({
      testSimulation: { persona: "former_student" },
    });

    expect(guidance).toContain("consulta get_student_package_status antes de responder");
    expect(guidance).toContain(
      "exige renovarla antes de una reserva nueva aunque el paquete conserve créditos vigentes",
    );
    expect(guidance).toContain("renovar inscripción no extiende el paquete");
  });
});
