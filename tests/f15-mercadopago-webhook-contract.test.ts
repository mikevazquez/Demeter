import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F15 Mercado Pago webhook and activation", () => {
  it("validates Mercado Pago webhook signatures before processing", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");
    const config = source("supabase/config.toml");

    expect(webhook).toContain('Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")');
    expect(webhook).toContain("id:${dataId};request-id:${xRequestId};ts:${ts};");
    expect(webhook).toContain('hash: "SHA-256"');
    expect(webhook).toContain("constantTimeEqual");
    expect(webhook).toContain('request.headers.get("x-signature")');
    expect(config).toContain("[functions.mercadopago-webhook]");
    expect(config).toContain("verify_jwt = false");
  });

  it("re-reads the order from Mercado Pago and never trusts the webhook body for approval", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");

    expect(webhook).toContain("https://api.mercadopago.com/v1/orders/");
    expect(webhook).toContain("authorization: `Bearer ${accessToken}`");
    expect(webhook).toContain('providerStatus?.toLowerCase() === "processed"');
    expect(webhook).toContain('providerStatusDetail?.toLowerCase() === "accredited"');
    expect(webhook).toContain("totalAmountMinor !== attempt.amount_minor");
    expect(webhook).toContain("safeText(order.currency)");
    expect(webhook).not.toContain("order.currency_id");
    expect(webhook).toContain("currency !== attempt.currency.toUpperCase()");
  });

  it("activates commercial entities only through the service-role atomic RPC", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");
    const migration = source(
      "supabase/migrations/20260917034000_f15_online_checkout_activation.sql",
    );

    expect(webhook).toContain('supabase.rpc(\n      "service_confirm_online_checkout_approved"');
    expect(webhook).not.toContain('.from("sales").insert');
    expect(webhook).not.toContain('.from("payments").insert');
    expect(webhook).not.toContain('.from("product_acquisitions").insert');
    expect(webhook).not.toContain('.from("credit_ledger").insert');

    expect(migration).toContain("for update");
    expect(migration).toContain(
      "if v_attempt.processed_at is not null or v_attempt.sale_id is not null",
    );
    expect(migration).toContain("insert into public.sales");
    expect(migration).toContain("insert into public.payments");
    expect(migration).toContain("insert into public.product_acquisitions");
    expect(migration).toContain("insert into public.credit_ledger");
    expect(migration).toContain("payments_mercado_pago_reference_unique");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("freezes entitlement data before redirecting to Mercado Pago", () => {
    const migration = source(
      "supabase/migrations/20260917034000_f15_online_checkout_activation.sql",
    );

    expect(migration).toContain("product_name_snapshot");
    expect(migration).toContain("validity_days_snapshot");
    expect(migration).toContain("credit_limit_snapshot");
    expect(migration).toContain("unlimited_snapshot");
    expect(migration).toContain("v_product.price_minor");
    expect(migration).toContain("v_product.validity_days");
    expect(migration).toContain("v_product.credit_limit");
  });

  it("keeps an audit trail and maps non-approved provider states without granting access", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");
    const migration = source(
      "supabase/migrations/20260917034000_f15_online_checkout_activation.sql",
    );

    expect(migration).toContain("create table if not exists public.online_checkout_webhook_events");
    expect(webhook).toContain('processing_status: "received"');
    expect(webhook).toContain('status === "processing" || status === "action_required"');
    expect(webhook).toContain('status === "failed"');
    expect(webhook).toContain('status === "canceled" || status === "cancelled"');
    expect(webhook).toContain("if (attempt.processed_at || attempt.sale_id)");
  });

  it("uses payment transaction state when a rejected checkout leaves the order created", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");

    expect(webhook).toContain("const payments = Array.isArray(order.transactions?.payments)");
    expect(webhook).toContain("const failedPayment = payments?.find(");
    expect(webhook).toContain('safeText(item.status)?.toLowerCase() === "failed"');
    expect(webhook).toContain(
      "const nonApprovedProviderStatus = usePaymentState ? paymentStatus : providerStatus",
    );
    expect(webhook).toContain("provider_status: nonApprovedProviderStatus");
    expect(webhook).toContain("provider_status_detail: nonApprovedProviderStatusDetail");
  });

  it("distinguishes reused approvals in webhook audit results", () => {
    const webhook = source("supabase/functions/mercadopago-webhook/index.ts");

    expect(webhook).toContain(
      'activation?.reused === true ? "approved_reused" : "approved_activated"',
    );
  });
});
