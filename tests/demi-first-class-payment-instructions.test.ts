import { describe, it, expect } from "vitest";
import { firstClassPaymentInstructions } from "../lib/assistant/first-class-payment-instructions";

describe("First-class payment instructions preserve receipt before identity", () => {
  const quote = {
    status: "payment_required",
    amount_minor: 15000,
    currency: "MXN",
    external_checkout: { url: "https://mpago.la/UAT-FICTICIO-NO-PAGAR", test_only: true },
    bank_details: { bank_name: "UAT", account_holder: "NO TRANSFERIR", account_number: "0000" },
  };
  it("shares the exact configured link with the test warning and waits for the receipt", () => {
    const text = firstClassPaymentInstructions(quote, "Quiero Mercado Pago")!;
    expect(text).toContain(quote.external_checkout.url);
    expect(text).toContain("no realices un pago real");
    expect(text).toContain("Después de revisarlo te pediré los datos");
    expect(text).not.toMatch(/nombre|celular|teléfono/i);
    expect(text).toContain("no hay una reserva confirmada");
  });
  it("uses configured bank instructions when transfer is requested", () => {
    const text = firstClassPaymentInstructions(quote, "Por transferencia")!;
    expect(text).toContain("Cuenta: 0000");
    expect(text).not.toContain("mpago.la");
  });
  it("does not repeat payment instructions after a receipt was accepted", () => {
    expect(
      firstClassPaymentInstructions(
        { ...quote, status: "participant_data_required" },
        "Mercado Pago",
      ),
    ).toBeNull();
  });
});
