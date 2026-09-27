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

type PortalRequest = {
  studioId?: unknown;
  returnBaseUrl?: unknown;
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

  let payload: PortalRequest;
  try {
    payload = (await request.json()) as PortalRequest;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const studioId = safeText(payload.studioId);
  const returnBaseUrl = validateReturnBaseUrl(payload.returnBaseUrl);
  if (!isUuid(studioId) || !returnBaseUrl) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const owner = await requireOwnerContext(adminClient, user, studioId!);
  if (!owner) return jsonResponse({ error: "owner_access_required" }, 403);

  if (
    owner.assignment.billing_provider !== "stripe" ||
    !owner.assignment.provider_customer_id
  ) {
    return jsonResponse({ error: "stripe_customer_missing" }, 409);
  }

  try {
    const returnUrl = new URL("/admin/suscripcion", returnBaseUrl);
    const session = await stripe.billingPortal.sessions.create({
      customer: owner.assignment.provider_customer_id,
      return_url: returnUrl.toString(),
    });

    return jsonResponse({ ok: true, portalUrl: session.url });
  } catch {
    return jsonResponse({ error: "stripe_portal_failed" }, 502);
  }
});
