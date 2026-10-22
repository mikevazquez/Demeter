import { describe, expect, it } from "vitest";
import { prospectCashPaymentStage } from "../lib/assistant/conversation-guidance";

const prospect = { crmContactId: "contact" };
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });
const first = [
  assistant("Para asegurar tu clase se requiere pago anticipado."),
  user("¿Puedo pagar en efectivo en el estudio?"),
];

describe("prospect payment objection stages", () => {
  it("keeps a first cash question at the first stage", () => {
    expect(prospectCashPaymentStage(prospect, first)).toBe("first_objection");
  });

  it.each(["No gracias, sólo puedo en efectivo.", "No gracias, no puedo."])(
    "advances after a renewed refusal: %s",
    (message) => {
      expect(
        prospectCashPaymentStage(prospect, [
          ...first,
          assistant("Se requiere pago anticipado para asegurar tu lugar."),
          user(message),
        ]),
      ).toBe("second_refusal");
    },
  );

  it("counts inability to transfer and then deposit as two payment objections", () => {
    expect(
      prospectCashPaymentStage(prospect, [
        user("No puedo hacer transferencia."),
        assistant("También puedes depositar por adelantado si está habilitado."),
        user("Tampoco puedo depositar por adelantado."),
      ]),
    ).toBe("second_refusal");
  });

  it("does not count a location question and preserves the earlier objection", () => {
    const history = [...first, assistant("Se necesita anticipo."), user("¿Dónde están?")];
    expect(prospectCashPaymentStage(prospect, history)).toBeNull();
    expect(
      prospectCashPaymentStage(prospect, [
        ...history,
        assistant("Estamos en el domicilio oficial."),
        user("No gracias, sólo puedo en efectivo."),
      ]),
    ).toBe("second_refusal");
  });

  it("resets the sequence on acceptance of advance payment", () => {
    const history = [...first, user("Mejor sí, pásame cómo depositar en OXXO.")];
    expect(prospectCashPaymentStage(prospect, history)).toBeNull();
    expect(prospectCashPaymentStage(prospect, [...history, user("Sólo puedo en efectivo.")])).toBe(
      "first_objection",
    );
  });

  it.each(["No, mejor ya no voy.", "Quiero hablar con una persona.", "hola"])(
    "leaves unrelated intent to its own policy: %s",
    (message) => {
      expect(prospectCashPaymentStage(prospect, [...first, user(message)])).toBeNull();
    },
  );

  it("does not count technical failures as payment objections", () => {
    expect(
      prospectCashPaymentStage(prospect, [
        { role: "tool", content: "cash_purchase_failed" },
        assistant("Falló la consulta."),
        user("¿Puedo pagar en efectivo?"),
      ]),
    ).toBe("first_objection");
  });

  it("excludes verified students, unresolved identities and student simulations", () => {
    for (const audience of [
      { studentId: "student", crmContactId: "contact" },
      {},
      { testSimulation: { persona: "student" as const } },
    ]) {
      expect(prospectCashPaymentStage(audience, first)).toBeNull();
    }
  });

  it("does not interpret rejecting cash as rejecting advance payment", () => {
    expect(
      prospectCashPaymentStage(prospect, [
        ...first,
        user("No quiero efectivo, prefiero transferencia."),
      ]),
    ).toBeNull();
  });

  it.each([
    "Sólo puedo en efectivo y quiero hablar con una persona.",
    "Sólo puedo pagar en efectivo, mejor ya no voy.",
  ])("preserves an explicit human request or departure alongside cash: %s", (message) => {
    expect(prospectCashPaymentStage(prospect, [...first, user(message)])).toBeNull();
  });

  it("does not replace an existing simulated reservation with a walk-in", () => {
    expect(
      prospectCashPaymentStage(
        { testSimulation: { persona: "prospect", reservations: [{ id: "booked" }] } },
        first,
      ),
    ).toBeNull();
  });

  it("resets after the exact operational acceptance message before another cash request", () => {
    expect(
      prospectCashPaymentStage(prospect, [
        ...first,
        assistant("El pago anticipado asegura el lugar."),
        user("No gracias, sólo puedo pagar en efectivo, no puedo hacer el pago anticipado."),
        assistant("Puedes acudir sin reserva si hay cupo."),
        user("Mejor sí puedo pagar por adelantado. Pásame cómo depositar en OXXO para esa clase."),
        assistant("Transferencia o depósito OXXO: datos ficticios de UAT."),
        user("¿Puedo pagar en efectivo en el estudio?"),
      ]),
    ).toBe("first_objection");
  });
});
