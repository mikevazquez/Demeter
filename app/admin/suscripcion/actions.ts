"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requestOrigin() {
  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host");
  const proto = store.get("x-forwarded-proto") ?? "https";

  if (!host || !["http", "https"].includes(proto)) return null;
  return `${proto}://${host}`;
}

function stripeRedirectUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !(host === "stripe.com" || host.endsWith(".stripe.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function ownerContext() {
  const ctx = await getAdminContext(undefined, { allowRestricted: true });
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");
  return ctx;
}

export async function startStripeCheckoutAction(formData: FormData) {
  const ctx = await ownerContext();
  const planKey = field(formData, "plan_key");
  const billingInterval = field(formData, "billing_interval");
  const returnBaseUrl = await requestOrigin();

  if (
    !planKey ||
    !["month", "year"].includes(billingInterval) ||
    !returnBaseUrl
  ) {
    redirect("/admin/suscripcion?billing_error=invalid_request");
  }

  const { data, error } = await ctx.supabase.functions.invoke(
    "saas-stripe-checkout",
    {
      body: {
        studioId: ctx.studio.id,
        planKey,
        billingInterval,
        clientRequestKey: crypto.randomUUID(),
        returnBaseUrl,
      },
    },
  );

  const checkoutUrl = stripeRedirectUrl(data?.checkoutUrl);
  if (error || !checkoutUrl) {
    redirect("/admin/suscripcion?billing_error=checkout_unavailable");
  }

  redirect(checkoutUrl);
}

export async function openStripePortalAction() {
  const ctx = await ownerContext();
  const returnBaseUrl = await requestOrigin();

  if (!returnBaseUrl) {
    redirect("/admin/suscripcion?billing_error=invalid_request");
  }

  const { data, error } = await ctx.supabase.functions.invoke(
    "saas-stripe-portal",
    {
      body: {
        studioId: ctx.studio.id,
        returnBaseUrl,
      },
    },
  );

  const portalUrl = stripeRedirectUrl(data?.portalUrl);
  if (error || !portalUrl) {
    redirect("/admin/suscripcion?billing_error=portal_unavailable");
  }

  redirect(portalUrl);
}
