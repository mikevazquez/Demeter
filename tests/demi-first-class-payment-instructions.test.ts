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
    expect(text).toContain("Al recibirlo te pediré juntos los datos faltantes");
    expect(text).toContain("reserva quedará sujeta a esa validación");
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
  it("waits for the provider rather than a receipt for an automatic checkout", () => {
    const text = firstClassPaymentInstructions(
      {
        ...quote,
        external_checkout: {
          ...quote.external_checkout,
          receipt_required: false,
          automatic_verification: true,
        },
      },
      "Quiero pagar",
    )!;
    expect(text).toContain("No necesitas enviar comprobante");
    expect(text).toContain("Esperaré la confirmación de Mercado Pago");
    expect(text).not.toContain("Envíame el comprobante");
    expect(text).not.toMatch(/nombre|celular|teléfono/i);
  });
  it.each(["Deposito en OXXO", "Bancomer", "Transferencia BBVA"])(
    "keeps %s on the manual bank route",
    (request) => {
      const text = firstClassPaymentInstructions(
        {
          ...quote,
          external_checkout: {
            ...quote.external_checkout,
            receipt_required: false,
            automatic_verification: true,
          },
        },
        request,
      )!;
      expect(text).toContain("Cuenta: 0000");
      expect(text).toContain("equipo validará el pago manualmente");
      expect(text).not.toContain("mpago.la");
    },
  );
});
