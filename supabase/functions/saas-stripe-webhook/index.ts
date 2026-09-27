import Stripe from "npm:stripe@22.6.2";

import {
  getAdminClient,
  getStripeClient,
  invoiceSubscriptionId,
  jsonResponse,
  resolveStudioIdForSubscription,
  safeText,
  stripeId,
  subscriptionItemSnapshot,
  toIsoTimestamp,
} from "../_shared/stripe-billing.ts";

type SyncOptions = {
  invoiceId?: string | null;
  paymentSucceeded?: boolean;
  paymentFailed?: boolean;
};

type SyncResult = {
  ignored: boolean;
  studioId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  reason?: string;
};

const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function markWebhook(
  adminClient: ReturnType<typeof getAdminClient>,
  eventId: string,
  values: Record<string, unknown>,
) {
  if (!adminClient) return;
  await adminClient
    .from("saas_billing_webhook_events")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("provider", "stripe")
    .eq("event_id", eventId);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const stripe = getStripeClient();
  const adminClient = getAdminClient();
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET")?.trim();

  if (!stripe || !adminClient || !webhookSecret) {
    return jsonResponse({ error: "billing_not_configured" }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature ?? "",
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch {
    return jsonResponse({ error: "invalid_signature" }, 400);
  }

  const eventCreatedAt = toIsoTimestamp(event.created);
  if (!eventCreatedAt) {
    return jsonResponse({ error: "invalid_event_time" }, 400);
  }

  const { data: inserted, error: insertError } = await adminClient
    .from("saas_billing_webhook_events")
    .insert({
      provider: "stripe",
      event_id: event.id,
      event_type: event.type,
      event_created_at: eventCreatedAt,
      status: "received",
    })
    .select("id,status")
    .maybeSingle();

  if (insertError) {
    if (insertError.code !== "23505") {
      return jsonResponse({ error: "event_persist_failed" }, 500);
    }

    const { data: existing, error: lookupError } = await adminClient
      .from("saas_billing_webhook_events")
      .select("status")
      .eq("provider", "stripe")
      .eq("event_id", event.id)
      .maybeSingle();

    if (lookupError || !existing) {
      return jsonResponse({ error: "event_lookup_failed" }, 500);
    }

    if (["completed", "ignored", "processing"].includes(existing.status)) {
      return jsonResponse({ ok: true, duplicate: true });
    }
  } else if (!inserted) {
    return jsonResponse({ error: "event_persist_failed" }, 500);
  }

  await markWebhook(adminClient, event.id, {
    status: "processing",
    error_code: null,
  });

  const syncSubscription = async (
    subscription: Stripe.Subscription,
    options: SyncOptions = {},
  ): Promise<SyncResult> => {
    const customerId = stripeId(subscription.customer);
    const subscriptionId = subscription.id;
    const studioId = await resolveStudioIdForSubscription(adminClient, subscription);

    if (!studioId) {
      return {
        ignored: true,
        studioId: null,
        customerId,
        subscriptionId,
        reason: "studio_unmapped",
      };
    }

    const { priceId, currentPeriodStart, currentPeriodEnd } =
      subscriptionItemSnapshot(subscription);

    if (!customerId || !priceId) {
      throw new Error("subscription_context_incomplete");
    }

    const { data, error } = await adminClient.rpc(
      "service_apply_stripe_subscription_state",
      {
        p_event_created_at: eventCreatedAt,
        p_studio_id: studioId,
        p_customer_id: customerId,
        p_subscription_id: subscriptionId,
        p_price_id: priceId,
        p_provider_status: subscription.status,
        p_current_period_start: currentPeriodStart,
        p_current_period_end: currentPeriodEnd,
        p_trial_started_at: toIsoTimestamp(subscription.trial_start),
        p_trial_ends_at: toIsoTimestamp(subscription.trial_end),
        p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        p_cancelled_at: toIsoTimestamp(subscription.canceled_at),
        p_invoice_id: options.invoiceId ?? null,
        p_payment_succeeded: options.paymentSucceeded ?? false,
        p_payment_failed: options.paymentFailed ?? false,
        p_reason: `Stripe ${event.type}`,
      },
    );

    if (error) {
      throw new Error(error.message || "subscription_sync_failed");
    }

    const result = data as { ignored?: boolean; reason?: string } | null;
    return {
      ignored: Boolean(result?.ignored),
      studioId,
      customerId,
      subscriptionId,
      ...(result?.reason ? { reason: result.reason } : {}),
    };
  };

  try {
    let result: SyncResult | null = null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const attemptId = safeText(session.metadata?.checkout_attempt_id);

      const attemptUpdate = adminClient
        .from("saas_billing_checkout_attempts")
        .update({
          status: "completed",
          failure_code: null,
          updated_at: new Date().toISOString(),
        });

      if (attemptId) {
        await attemptUpdate.eq("id", attemptId);
      } else {
        await attemptUpdate
          .eq("provider", "stripe")
          .eq("provider_checkout_session_id", session.id);
      }

      const subscriptionId = stripeId(session.subscription);
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        result = await syncSubscription(subscription);
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await adminClient
        .from("saas_billing_checkout_attempts")
        .update({
          status: "expired",
          checkout_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq("provider", "stripe")
        .eq("provider_checkout_session_id", session.id);
    } else if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "customer.subscription.trial_will_end",
      ].includes(event.type)
    ) {
      result = await syncSubscription(event.data.object as Stripe.Subscription);
    } else if (
      ["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"].includes(
        event.type,
      )
    ) {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);

      if (!subscriptionId) {
        result = {
          ignored: true,
          studioId: null,
          customerId: stripeId(invoice.customer),
          subscriptionId: null,
          reason: "invoice_without_subscription",
        };
      } else {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        result = await syncSubscription(subscription, {
          invoiceId: invoice.id,
          paymentSucceeded: event.type === "invoice.paid",
          paymentFailed:
            event.type === "invoice.payment_failed" ||
            event.type === "invoice.payment_action_required",
        });
      }
    } else {
      await markWebhook(adminClient, event.id, {
        status: "ignored",
        error_code: "unsupported_event_type",
        processed_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true, ignored: true });
    }

    const ignored = Boolean(result?.ignored);
    await markWebhook(adminClient, event.id, {
      status: ignored ? "ignored" : "completed",
      error_code: ignored ? result?.reason ?? "ignored" : null,
      processed_at: new Date().toISOString(),
      studio_id: result?.studioId ?? null,
      provider_customer_id: result?.customerId ?? null,
      provider_subscription_id: result?.subscriptionId ?? null,
    });

    return jsonResponse({
      ok: true,
      ignored,
      ...(result?.reason ? { reason: result.reason } : {}),
    });
  } catch (error) {
    const errorCode =
      error instanceof Error && error.message
        ? error.message.slice(0, 200)
        : "stripe_webhook_processing_failed";

    await markWebhook(adminClient, event.id, {
      status: "failed",
      error_code: errorCode,
      processed_at: new Date().toISOString(),
    });

    return jsonResponse({ error: "stripe_webhook_processing_failed" }, 500);
  }
});
