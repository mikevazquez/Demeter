import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isExplicitCashPurchaseConfirmation } from "../lib/assistant/action-tools";

const summary = {
  amount_minor: 60000,
  product_name: "Paquete de 8 clases",
  payment_due_on: "2026-10-23",
  local_date: "2026-10-22",
};
const yes = "Sí, confirmo la compra del paquete en efectivo.";

describe("F07: cash package confirmation preserves the agreed payment date", () => {
  it.each([
    yes,
    `${yes} Lo pagaré mañana, 23 de octubre.`,
    `${yes} Lo pagaré mañana.`,
    `${yes} Lo pagaré el 23 de octubre de 2026.`,
    `${yes} Lo pagaré 2026-10-23.`,
    "Confirmo la compra del paquete de 8 clases por $600 en efectivo. Pago mañana.",
  ])("accepts matching pending details: %s", (message) => {
    expect(isExplicitCashPurchaseConfirmation(message, summary)).toBe(true);
  });

  it.each([
    `${yes} Lo pagaré hoy.`,
    `${yes} Lo pagaré pasado mañana.`,
    `${yes} Lo pagaré mañana, 24 de octubre.`,
    `${yes} Lo pagaré 2026-11-23.`,
    `${yes} Lo pagaré el 23 de octubre de 2027.`,
    `${yes} Lo pagaré mañana si puedo.`,
    `${yes} Lo pagaré mañana, pero no lo registres.`,
    `${yes} Lo pagaré después.`,
    `¿${yes} Lo pagaré mañana?`,
    "No confirmo la compra del paquete en efectivo. Lo pagaré mañana.",
    "Confirmo la compra del paquete de 12 clases por 600 en efectivo. Lo pagaré mañana.",
    "Confirmo la compra del paquete de 8 clases por 601 en efectivo. Lo pagaré mañana.",
    "Sí, cancélala.",
    "Sí, reagéndala.",
    "Resérvala.",
  ])("rejects contradiction, ambiguity or another action: %s", (message) => {
    expect(isExplicitCashPurchaseConfirmation(message, summary)).toBe(false);
  });

  it("requires an agreed due date and studio-local date for relative wording", () => {
    const message = `${yes} Lo pagaré mañana.`;
    expect(isExplicitCashPurchaseConfirmation(message, { ...summary, payment_due_on: null })).toBe(
      false,
    );
    expect(isExplicitCashPurchaseConfirmation(message, { ...summary, local_date: undefined })).toBe(
      false,
    );
    expect(
      isExplicitCashPurchaseConfirmation(message, { ...summary, local_date: "2026-10-23" }),
    ).toBe(false);
  });
});
