import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F15 Mercado Pago Orders API", () => {
  it("creates Checkout Pro orders only from the authenticated backend", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");
    const config = source("supabase/config.toml");

    expect(edge).toContain('Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")');
    expect(edge).toContain('fetch("https://api.mercadopago.com/v1/orders"');
    expect(edge).toContain('"x-idempotency-key": attemptRow.client_request_key');
    expect(edge).toContain('userClient.rpc(\n      "student_create_online_checkout_attempt"');
    expect(config).toContain("[functions.create-mercadopago-order]");
    expect(config).toContain("verify_jwt = true");
  });

  it("uses only supported Checkout Pro order properties", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");

    expect(edge).toContain('type: "online"');
    expect(edge).toContain('processing_mode: "manual"');
    expect(edge).toContain("total_amount: totalAmount");
    expect(edge).toContain("unit_price: totalAmount");
    expect(edge).toContain("quantity: 1");
    expect(edge).not.toContain("notification_url");
    expect(edge).not.toContain("unit_measure");
    expect((edge.match(/total_amount: totalAmount/g) ?? []).length).toBe(1);
  });

  it("uses the frozen server amount and never accepts a client price or student id", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");
    const actions = source("app/student/actions.ts");

    expect(edge).toContain("moneyFromMinor(attemptRow.amount_minor)");
    expect(edge).toContain("attemptRow.external_reference");
    expect(edge).not.toContain("target_amount_minor");
    expect(edge).not.toContain("studentId?:");
    expect(actions).not.toContain("priceMinor");
    expect(actions).not.toContain("studentId");
  });

  it("resolves payer email from the server-side student record and never from the client", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");
    const actions = source("app/student/actions.ts");

    expect(edge).toContain('.from("students")');
    expect(edge).toContain('.select("id,email")');
    expect(edge).toContain("validPayerEmail(student.email)");
    expect(edge).toContain("payer: { email: payerEmail }");
    expect(edge).toContain('email.endsWith(".invalid")');
    expect(actions).not.toContain("payerEmail");
    expect(actions).not.toContain("payer_email");
  });

  it("does not activate commercial entities when merely creating an order", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");

    expect(edge).not.toContain('.from("sales")');
    expect(edge).not.toContain('.from("payments")');
    expect(edge).not.toContain('.from("product_acquisitions")');
    expect(edge).not.toContain('.from("credit_ledger")');
  });

  it("exposes only explicitly purchasable packages in the student catalog", () => {
    const page = source("app/student/paquete/page.tsx");

    expect(page).toContain('.eq("online_purchasable", true)');
    expect(page).toContain('.in("product_type", ["package", "membership"])');
    expect(page).toContain("Mensual");
    expect(page).toContain("Trimestral");
    expect(page).toContain("Semestral");
    expect(page).toContain("Anual");
    expect(page).toContain("Otra vigencia");
    expect(page).toContain("PurchasePackageButton");
  });

  it("reuses one client request key through retries and redirects only to the backend checkout URL", () => {
    const button = source("app/student/paquete/purchase-package-button.tsx");
    const actions = source("app/student/actions.ts");

    expect(button).toContain("requestKeyRef");
    expect(button).toContain("crypto.randomUUID()");
    expect(button).toContain("createMercadoPagoOrderAction(productTemplateId, requestKey)");
    expect(button).toContain("window.location.assign(result.checkoutUrl)");
    expect(actions).toContain('supabase.functions.invoke("create-mercadopago-order"');
    expect(actions).toContain('checkoutUrl.protocol !== "https:"');
  });
});
