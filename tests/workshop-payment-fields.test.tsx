import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkshopPaymentMethodFields } from "@/components/WorkshopPaymentMethodFields";

describe("workshop payment reference fields", () => {
  it("does not ask for a bank reference when paying cash", () => {
    const html = renderToStaticMarkup(<WorkshopPaymentMethodFields />);
    expect(html).toContain('value="cash" selected=""');
    expect(html).not.toContain('name="payment_reference"');
  });
  it("requires and labels the bank reference only for a transfer", () => {
    const html = renderToStaticMarkup(
      <WorkshopPaymentMethodFields initialMethod="bank_transfer" />,
    );
    expect(html).toContain("Referencia bancaria");
    const input = html.match(/<input[^>]*>/)?.[0];
    expect(input).toContain('name="payment_reference"');
    expect(input).toContain('required=""');
  });
});
