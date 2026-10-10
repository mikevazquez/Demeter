import { describe, expect, it } from "vitest";
import {
  demiCheckoutUrl,
  demiOrderBody,
  demiTestSeller,
} from "../supabase/functions/_shared/demi-mercadopago";

describe("Demi Mercado Pago order", () => {
  const payment = {
    amount_minor: 15000,
    currency: "MXN",
    external_reference: "demi_11111111-1111-4111-8111-111111111111",
  };
  it("ties the provider checkout to a request without requiring a student or payer email", () => {
    const body = demiOrderBody(payment);
    expect(body.total_amount).toBe("150.00");
    expect(body.external_reference).toBe(payment.external_reference);
    expect(body).not.toHaveProperty("payer");
    expect(body.config.payment_method.not_allowed_ids).toContain("oxxo");
    expect(body.config.payment_method.not_allowed_types).toContain("ticket");
  });
  it.each([-1, 0, 15000.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid backend amount %s",
    (amount_minor) => {
      expect(() => demiOrderBody({ ...payment, amount_minor })).toThrow("invalid_payment_snapshot");
    },
  );
  it("rejects an unsupported currency or unrelated reference", () => {
    expect(() => demiOrderBody({ ...payment, currency: "USD" })).toThrow();
    expect(() => demiOrderBody({ ...payment, external_reference: "another-student" })).toThrow();
  });
  it.each([
    "https://evil.invalid/pay",
    "https://www.mercadopago.com.mx.evil.invalid/pay",
    "https://user:pass@www.mercadopago.com.mx/pay",
    "http://www.mercadopago.com.mx/pay",
    "https://www.mercadopago.com.mx:8443/pay",
  ])("rejects an unsafe provider redirect %s", (url) => {
    expect(demiCheckoutUrl(url)).toBeNull();
  });
  it("allows only the official HTTPS Mexican checkout", () => {
    expect(
      demiCheckoutUrl("https://www.mercadopago.com.mx/checkout/v1/redirect?order=UAT"),
    ).toContain("mercadopago.com.mx/checkout");
  });
  it("allows APP_USR credentials only for an authenticated Mexican test seller", async () => {
    const fetcher = (async () =>
      Response.json({ tags: ["test_user"], site_id: "MLM" })) as typeof fetch;
    expect(await demiTestSeller("APP_USR-UAT-FICTICIO", fetcher)).toBe(true);
    expect(
      await demiTestSeller("APP_USR-UAT-FICTICIO", (async () =>
        Response.json({ tags: [], site_id: "MLM" })) as typeof fetch),
    ).toBe(false);
    expect(
      await demiTestSeller("APP_USR-UAT-FICTICIO", (async () =>
        Response.json({ tags: ["test_user"], site_id: "MLB" })) as typeof fetch),
    ).toBe(false);
  });
});
