import Stripe from "npm:stripe@22.6.2";
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const stripe = new Stripe((Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim());

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isUuid(value: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  return value || null;
}

export function getAdminClient() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthenticatedUser(request: Request) {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !anonKey || !authorization) {
    return { user: null, client: null, error: "unauthenticated" } as const;
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  return {
    user: error ? null : user,
    client,
    error: error ? "unauthenticated" : null,
  } as const;
}

type OwnerContext = {
  user: User;
  studio: {
    id: string;
    name: string;
    currency: string;
  };
  assignment: {
    plan_id: string;
    status: string;
    billing_provider: string | null;
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
  };
};

export async function requireOwnerContext(
  adminClient: SupabaseClient,
  user: User,
  studioId: string,
): Promise<OwnerContext | null> {
  const [{ data: account }, { data: membership }, { data: studio }, { data: assignment }] =
    await Promise.all([
      adminClient.from("user_accounts").select("id,status").eq("id", user.id).maybeSingle(),
      adminClient
        .from("studio_memberships")
        .select("studio_id,role,active")
        .eq("studio_id", studioId)
        .eq("user_id", user.id)
        .eq("active", true)
        .eq("role", "owner")
        .maybeSingle(),
      adminClient
        .from("studios")
        .select("id,name,currency,status")
        .eq("id", studioId)
        .maybeSingle(),
      adminClient
        .from("studio_plan_assignments")
        .select(
          "plan_id,status,billing_provider,provider_customer_id,provider_subscription_id",
        )
        .eq("studio_id", studioId)
        .maybeSingle(),
    ]);

  if (
    !account ||
    account.status !== "active" ||
    !membership ||
    !studio ||
    studio.status !== "active" ||
    !assignment
  ) {
    return null;
  }

  return {
    user,
    studio: {
      id: studio.id,
      name: studio.name,
      currency: String(studio.currency ?? "MXN"),
    },
    assignment,
  };
}

export function validateReturnBaseUrl(value: unknown) {
  const raw = safeText(value);
  const configured = (Deno.env.get("SAAS_BILLING_RETURN_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!raw || !configured.length) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!configured.includes(url.origin)) return null;
  return url.origin;
}

export function toIsoTimestamp(seconds: unknown) {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

export function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return safeText((value as { id?: unknown }).id);
  }
  return null;
}

export function subscriptionItemSnapshot(subscription: Stripe.Subscription) {
  const item = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number;
        current_period_end?: number;
      })
    | undefined;

  const priceId = item?.price?.id ?? null;
  const currentPeriodStart = toIsoTimestamp(item?.current_period_start);
  const currentPeriodEnd = toIsoTimestamp(item?.current_period_end);

  return { item, priceId, currentPeriodStart, currentPeriodEnd };
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const parent = invoice.parent as
    | {
        type?: unknown;
        subscription_details?: {
          subscription?: unknown;
        } | null;
      }
    | null
    | undefined;

  const currentApiSubscription =
    parent?.type === "subscription_details"
      ? stripeId(parent.subscription_details?.subscription)
      : null;

  const legacySubscription = stripeId(
    (invoice as Stripe.Invoice & { subscription?: unknown }).subscription,
  );

  return currentApiSubscription ?? legacySubscription;
}

export async function resolveStudioIdForSubscription(
  adminClient: SupabaseClient,
  subscription: Stripe.Subscription,
) {
  const metadataStudioId = safeText(subscription.metadata?.studio_id);
  if (isUuid(metadataStudioId)) return metadataStudioId;

  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;

  const { data } = await adminClient
    .from("studio_plan_assignments")
    .select("studio_id")
    .eq("billing_provider", "stripe")
    .or(
      `provider_subscription_id.eq.${subscription.id},provider_customer_id.eq.${customerId}`,
    )
    .maybeSingle();

  return data?.studio_id ?? null;
}
