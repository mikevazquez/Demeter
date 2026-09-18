import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F15 Mercado Pago return and reconciliation", () => {
  it("configures Checkout Pro Orders return URLs on the backend", () => {
    const edge = source("supabase/functions/create-mercadopago-order/index.ts");
    const actions = source("app/student/actions.ts");

    expect(edge).toContain("config: {");
    expect(edge).toContain("online: {");
    expect(edge).toContain("success_url: successUrl.toString()");
    expect(edge).toContain("failure_url: failureUrl.toString()");
    expect(edge).toContain("pending_url: pendingUrl.toString()");
    expect(edge).toContain('auto_return: "all"');
    expect(edge).toContain("validReturnBaseUrl(payload.returnBaseUrl)");
    expect(actions).toContain('requestHeaders.get("x-forwarded-host")');
    expect(actions).toContain('requestHeaders.get("host")');
    expect(actions).toContain('requestHeaders.get("x-forwarded-proto")');
    expect(actions).not.toContain("VERCEL_PROJECT_PRODUCTION_URL");
    expect(actions).toContain("returnBaseUrl,");
  });

  it("never accepts a browser-supplied payment outcome as commercial truth", () => {
    const page = source("app/student/paquete/checkout/page.tsx");
    const reconcile = source("supabase/functions/reconcile-mercadopago-order/index.ts");

    expect(page).toContain('supabase.functions.invoke("reconcile-mercadopago-order"');
    expect(page).toContain("Los parámetros de la");
    expect(page).not.toContain("service_confirm_online_checkout_approved");
    expect(reconcile).toContain("attemptId?: unknown");
    expect(reconcile).not.toContain("payload.outcome");
    expect(reconcile).not.toContain("payload.status");
  });

  it("reconciles only the authenticated student's attempt and re-fetches Mercado Pago", () => {
    const reconcile = source("supabase/functions/reconcile-mercadopago-order/index.ts");
    const config = source("supabase/config.toml");

    expect(reconcile).toContain('withSupabase({ auth: "user" }');
    expect(reconcile).toContain('.from("online_checkout_attempts")');
    expect(reconcile).toContain('.eq("id", attemptId)');
    expect(reconcile).toContain('.eq("provider", "mercado_pago")');
    expect(reconcile).toContain("https://api.mercadopago.com/v1/orders/");
    expect(config).toContain("[functions.reconcile-mercadopago-order]");
    expect(config).toContain("verify_jwt = true");
  });

  it("keeps approval server-side and requires processed plus accredited", () => {
    const reconcile = source("supabase/functions/reconcile-mercadopago-order/index.ts");

    expect(reconcile).toContain('providerStatus?.toLowerCase() === "processed"');
    expect(reconcile).toContain('providerStatusDetail?.toLowerCase() === "accredited"');
    expect(reconcile).toContain(
      'adminClient.rpc(\n        "service_confirm_online_checkout_approved"',
    );
    expect(reconcile).toContain("totalAmountMinor !== attempt.amount_minor");
    expect(reconcile).toContain("currency !== attempt.currency.toUpperCase()");
    expect(reconcile).toContain("paidAmountMinor !== attempt.amount_minor");
  });

  it("uses payment search only as a non-approved fallback", () => {
    const reconcile = source("supabase/functions/reconcile-mercadopago-order/index.ts");

    expect(reconcile).toContain('new URL("https://api.mercadopago.com/v1/payments/search")');
    expect(reconcile).toContain(
      'searchUrl.searchParams.set("external_reference", externalReference)',
    );
    expect(reconcile).toContain("itemReference === externalReference");
    expect(reconcile).toContain("itemCurrency === expectedCurrency.toUpperCase()");
    expect(reconcile).toContain("itemAmountMinor === expectedAmountMinor");
    expect(reconcile).toContain('status === "rejected"');
    expect(reconcile).toContain('status === "pending"');
  });
});
