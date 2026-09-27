import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04H Stripe billing", () => {
  const foundation = source(
    "supabase/migrations/20260927014303_dev_04h_stripe_billing_foundation.sql",
  );
  const audit = source(
    "supabase/migrations/20260927015051_dev_04h_stripe_plan_audit_source.sql",
  );
  const shared = source("supabase/functions/_shared/stripe-billing.ts");
  const checkout = source("supabase/functions/saas-stripe-checkout/index.ts");
  const portal = source("supabase/functions/saas-stripe-portal/index.ts");
  const webhook = source("supabase/functions/saas-stripe-webhook/index.ts");
  const config = source("supabase/config.toml");

  it("models provider prices, checkout attempts and idempotent webhook events", () => {
    expect(foundation).toContain("create table if not exists public.saas_plan_prices");
    expect(foundation).toContain("create table if not exists public.saas_billing_checkout_attempts");
    expect(foundation).toContain("create table if not exists public.saas_billing_webhook_events");
    expect(foundation).toContain("unique(provider, event_id)");
    expect(foundation).toContain("client_request_key uuid not null");
    expect(foundation).toContain("provider_event_created_at timestamptz");
  });

  it("keeps internal All Access outside provider-managed pricing", () => {
    expect(foundation).toContain("sp.internal_only = true");
    expect(foundation).toContain("stripe_internal_plan_forbidden");
    expect(checkout).toContain('.eq("internal_only", false)');
  });

  it("maps provider lifecycle into the Studio Flow subscription contract", () => {
    expect(foundation).toContain("service_apply_stripe_subscription_state");
    expect(foundation).toContain("when 'trialing' then 'trialing'");
    expect(foundation).toContain("when 'active' then 'active'");
    expect(foundation).toContain("when 'past_due' then 'past_due'");
    expect(foundation).toContain("when 'canceled' then 'cancelled'");
    expect(foundation).toContain("when 'unpaid' then 'suspended'");
    expect(foundation).toContain("make_interval(days => v_price.grace_days)");
    expect(foundation).toContain("provider_event_created_at > p_event_created_at");
  });

  it("attributes provider-driven plan and subscription audit events", () => {
    expect(audit).toContain("'assignment_source','stripe_webhook'");
    expect(audit).toContain("'billing_source','stripe_webhook'");
    expect(audit).toContain("'change_reason',v_reason");
    expect(audit).toContain("'billing_reason',v_reason");
  });

  it("reads billing periods from current Stripe SubscriptionItem fields", () => {
    expect(shared).toContain("subscription.items?.data?.[0]");
    expect(shared).toContain("current_period_start?: number");
    expect(shared).toContain("current_period_end?: number");
    expect(shared).toContain("toIsoTimestamp(item?.current_period_start)");
    expect(shared).toContain("toIsoTimestamp(item?.current_period_end)");
  });

  it("creates subscription checkout with owner validation and request idempotency", () => {
    expect(checkout).toContain("requireOwnerContext");
    expect(checkout).toContain("client_request_key");
    expect(checkout).toContain("studio-flow-checkout-");
    expect(checkout).toContain('mode: "subscription"');
    expect(checkout).toContain("subscription_data");
    expect(checkout).toContain("trial_period_days");
    expect(checkout).not.toContain("demeterbueno.vercel.app");
  });

  it("creates billing portal sessions only for the studio owner customer", () => {
    expect(portal).toContain("requireOwnerContext");
    expect(portal).toContain('billing_provider !== "stripe"');
    expect(portal).toContain("stripe.billingPortal.sessions.create");
  });

  it("verifies signed raw webhooks and persists idempotency before processing", () => {
    expect(webhook).toContain("const rawBody = await request.text()");
    expect(webhook).toContain("constructEventAsync");
    expect(webhook).toContain("STRIPE_WEBHOOK_SIGNING_SECRET");
    expect(webhook).toContain("saas_billing_webhook_events");
    expect(webhook).toContain('insertError.code !== "23505"');
    expect(webhook).toContain('"completed", "ignored", "processing"');
  });

  it("reacts to subscription and invoice lifecycle events", () => {
    expect(webhook).toContain('"customer.subscription.created"');
    expect(webhook).toContain('"customer.subscription.updated"');
    expect(webhook).toContain('"customer.subscription.deleted"');
    expect(webhook).toContain('"invoice.paid"');
    expect(webhook).toContain('"invoice.payment_failed"');
    expect(webhook).toContain("service_apply_stripe_subscription_state");
  });

  it("uses JWT for owner endpoints and Stripe signature auth for webhook", () => {
    expect(config).toContain("[functions.saas-stripe-checkout]\nverify_jwt = true");
    expect(config).toContain("[functions.saas-stripe-portal]\nverify_jwt = true");
    expect(config).toContain("[functions.saas-stripe-webhook]\nverify_jwt = false");
  });

  it("fails closed until Stripe secrets and allowed return origins are configured", () => {
    expect(shared).toContain("getStripeClient");
    expect(shared).toContain("SAAS_BILLING_RETURN_ORIGINS");
    expect(checkout).toContain('error: "billing_not_configured"');
    expect(portal).toContain('error: "billing_not_configured"');
    expect(webhook).toContain('error: "billing_not_configured"');
  });
});
