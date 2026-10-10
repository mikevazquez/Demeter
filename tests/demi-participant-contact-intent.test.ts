import { describe, expect, it } from "vitest";
import { hasExplicitSharedParticipantPhone } from "../lib/assistant/participant-contact-intent";

describe("shared participant contact requires identity review", () => {
  it.each([
    "Ambas comparten el mismo celular",
    "Las dos usan un solo teléfono",
    "Dos participantes tienen el mismo número",
  ])("recognizes an explicit shared contact: %s", (text) => {
    expect(hasExplicitSharedParticipantPhone(text)).toBe(true);
  });
  it.each([
    "Ambas no comparten el mismo celular",
    "Las dos no usan el mismo teléfono",
    "Quiero pagar por ambas, cada una tiene su celular",
    "Somos dos participantes",
  ])("does not infer a shared contact: %s", (text) => {
    expect(hasExplicitSharedParticipantPhone(text)).toBe(false);
  });
});
