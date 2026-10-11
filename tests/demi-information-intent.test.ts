import { describe, expect, it } from "vitest";
import {
  isInformationOnlyRequest,
  shouldBlockPaymentForInformation,
} from "../lib/assistant/information-intent";

describe("information while waiting for payment", () => {
  it.each([
    "Me parece bien, pero me podrías brindar más información?",
    "Antes de pagar tengo dudas",
    "¿Qué incluye la clase?",
    "¿Cuánto cuesta el paquete?",
    "¿Qué necesito llevar?",
  ])("does not authorize payment: %s", (message) => {
    expect(isInformationOnlyRequest(message)).toBe(true);
    expect(shouldBlockPaymentForInformation("prepare_first_class_payment", message)).toBe(true);
    expect(shouldBlockPaymentForInformation("get_studio_information", message)).toBe(false);
  });
  it.each([
    "Quiero agendar y dame información",
    "Puedes reservar y decirme qué necesito",
    "Pásame los datos para transferir",
    "Quiero pagar el paquete el día de clase",
  ])("keeps explicit actions available: %s", (message) => {
    expect(isInformationOnlyRequest(message)).toBe(false);
  });
});
