import {
  getAdminClient,
  getAuthenticatedUser,
  getStripeClient,
  isUuid,
  jsonResponse,
  requireOwnerContext,
  safeText,
  validateReturnBaseUrl,
} from "../_shared/stripe-billing.ts";

type CheckoutRequest = {
  studioId?: unknown;
  planKey?: unknown;
  billingInterval?: unknown;
  clientRequestKey?: unknown;
  returnBaseUrl?: unknown;
};

type CheckoutAttempt = {
  id: string;
  studio_id: string;
  plan_id: string;
  plan_price_id: string;
  client_request_key: string;
  status: string;
  provider_checkout_session_id: string | null;
  checkout_url: string | null;
  expires_at: string | null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const stripe = getStripeClient();
  const adminClient = getAdminClient();
  if (!stripe || !adminClient) {
    return jsonResponse({ error: "billing_not_configured" }, 503);
  }

  const { user } = await getAuthenticatedUser(request);
  if (!user) return jsonResponse({ error: "unauthenticated" }, 401);

  let payload: CheckoutRequest;
  try {
    payload = (await request.json()) as CheckoutRequest;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const studioId = safeText(payload.studioId);
  const planKey = safeText(payload.planKey);
  const billingInterval = safeText(payload.billingInterval);
  const clientRequestKey = safeText(payload.clientRequestKey);
  const returnBaseUrl = validateReturnBaseUrl(payload.returnBaseUrl);

  if (
    !isUuid(studioId) ||
    !isUuid(clientRequestKey) ||
    !planKey ||
    !["month", "year"].includes(billingInterval ?? "") ||
    !returnBaseUrl
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const owner = await requireOwnerContext(adminClient, user, studioId!);
  if (!owner) return jsonResponse({ error: "owner_access_required" }, 403);

  if (
    owner.assignment.billing_provider === "stripe" &&
    owner.assignment.provider_subscription_id &&
    owner.assignment.status !== "cancelled"
  ) {
    return jsonResponse({ error: "subscription_exists" }, 409);
  }

  const { data: plan, error: planError } = await adminClient
    .from("saas_plans")
    .select("id,plan_key,name,active,internal_only")
    .eq("plan_key", planKey)
    .eq("active", true)
    .eq("internal_only", false)
    .maybeSingle();

  if (planError || !plan) {
    return jsonResponse({ error: "plan_not_available" }, 404);
  }

  const currency = owner.studio.currency.toLowerCase();
  const { data: planPrice, error: priceError } = await adminClient
    .from("saas_plan_prices")
    .select(
      "id,plan_id,provider,billing_interval,currency,amount_minor,provider_product_id,provider_price_id,trial_days,grace_days,active",
    )
    .eq("plan_id", plan.id)
    .eq("provider", "stripe")
    .eq("billing_interval", billingInterval)
    .eq("currency", currency)
    .eq("active", true)
    .maybeSingle();

  if (priceError || !planPrice) {
    return jsonResponse({ error: "price_not_configured" }, 409);
  }

  const { data: existingAttempt, error: attemptLookupError } = await adminClient
    .from("saas_billing_checkout_attempts")
    .select(
      "id,studio_id,plan_id,plan_price_id,client_request_key,status,provider_checkout_session_id,checkout_url,expires_at",
    )
    .eq("studio_id", owner.studio.id)
    .eq("client_request_key", clientRequestKey)
    .maybeSingle();

  if (attemptLookupError) {
    return jsonResponse({ error: "checkout_attempt_failed" }, 500);
  }

  if (
    existingAttempt &&
    (existingAttempt.plan_id !== plan.id || existingAttempt.plan_price_id !== planPrice.id)
  ) {
    return jsonResponse({ error: "request_key_reused_for_different_plan" }, 409);
  }

  const existing = existingAttempt as CheckoutAttempt | null;
  if (
    existing?.status === "checkout_created" &&
    existing.checkout_url &&
    (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())
  ) {
    return jsonResponse({
      ok: true,
      checkoutUrl: existing.checkout_url,
      checkoutSessionId: existing.provider_checkout_session_id,
      attemptId: existing.id,
      reused: true,
    });
  }

  let attempt = existing;
  if (!attempt) {
    const { data, error } = await adminClient
      .from("saas_billing_checkout_attempts")
      .insert({
        studio_id: owner.studio.id,
        plan_id: plan.id,
        plan_price_id: planPrice.id,
        provider: "stripe",
        client_request_key: clientRequestKey,
        created_by: user.id,
        status: "created",
      })
      .select(
        "id,studio_id,plan_id,plan_price_id,client_request_key,status,provider_checkout_session_id,checkout_url,expires_at",
      )
      .single();

    if (error || !data) {
      return jsonResponse({ error: "checkout_attempt_failed" }, 500);
    }
    attempt = data as CheckoutAttempt;
  }

  let customerId =
    owner.assignment.billing_provider === "stripe"
      ? owner.assignment.provider_customer_id
      : null;

  try {
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          ...(user.email ? { email: user.email } : {}),
          name: owner.studio.name,
          metadata: {
            studio_id: owner.studio.id,
            owner_user_id: user.id,
          },
        },
        { idempotencyKey: `studio-flow-customer-${owner.studio.id}` },
      );
      customerId = customer.id;

      const { error: assignmentError } = await adminClient
        .from("studio_plan_assignments")
        .update({
          billing_provider: "stripe",
          provider_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq("studio_id", owner.studio.id);

      if (assignmentError) {
        throw new Error("customer_persist_failed");
      }
    }

    const successUrl = new URL("/admin/suscripcion", returnBaseUrl);
    successUrl.searchParams.set("checkout", "success");
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const cancelUrl = new URL("/admin/suscripcion", returnBaseUrl);
    cancelUrl.searchParams.set("checkout", "cancelled");

    const metadata = {
      studio_id: owner.studio.id,
      plan_key: plan.plan_key,
      plan_price_id: planPrice.id,
      checkout_attempt_id: attempt.id,
    };

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: owner.studio.id,
        line_items: [{ price: planPrice.provider_price_id, quantity: 1 }],
        success_url: successUrl.toString(),
        cancel_url: cancelUrl.toString(),
        metadata,
        subscription_data: {
          metadata,
          ...(planPrice.trial_days > 0 ? { trial_period_days: planPrice.trial_days } : {}),
        },
      },
      { idempotencyKey: `studio-flow-checkout-${attempt.id}` },
    );

    if (!session.url) {
      throw new Error("checkout_url_missing");
    }

    const expiresAt =
      typeof session.expires_at === "number"
        ? new Date(session.expires_at * 1000).toISOString()
        : null;

    const { error: persistError } = await adminClient
      .from("saas_billing_checkout_attempts")
      .update({
        status: "checkout_created",
        provider_checkout_session_id: session.id,
        checkout_url: session.url,
        expires_at: expiresAt,
        failure_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    if (persistError) {
      throw new Error("checkout_persist_failed");
    }

    return jsonResponse({
      ok: true,
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      attemptId: attempt.id,
      reused: false,
    });
  } catch (error) {
    const failureCode =
      error instanceof Error && error.message
        ? error.message.slice(0, 120)
        : "stripe_checkout_failed";

    await adminClient
      .from("saas_billing_checkout_attempts")
      .update({
        status: "error",
        failure_code: failureCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    return jsonResponse({ error: "stripe_checkout_failed" }, 502);
  }
});
