import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

import { openStripePortalAction, startStripeCheckoutAction } from "./actions";

function formatDate(value: string | null, locale: string, timeZone: string) {
  if (!value) return "No configurado";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

const statusCopy: Record<
  string,
  { title: string; detail: string; tone: "ok" | "warn" | "blocked" }
> = {
  active: {
    title: "Suscripción activa",
    detail: "El estudio tiene acceso operativo completo según su plan.",
    tone: "ok",
  },
  trialing: {
    title: "Periodo de prueba",
    detail: "El estudio conserva acceso completo mientras el trial siga vigente.",
    tone: "warn",
  },
  trial_expired: {
    title: "Periodo de prueba vencido",
    detail: "La operación está restringida hasta activar una suscripción.",
    tone: "blocked",
  },
  past_due_grace: {
    title: "Pago pendiente · periodo de gracia",
    detail: "El estudio conserva acceso temporalmente mientras el periodo de gracia siga vigente.",
    tone: "warn",
  },
  past_due_expired: {
    title: "Pago pendiente · acceso restringido",
    detail: "El periodo de gracia terminó. La operación está restringida hasta regularizar la suscripción.",
    tone: "blocked",
  },
  suspended: {
    title: "Suscripción suspendida",
    detail: "La operación del estudio está restringida.",
    tone: "blocked",
  },
  cancelled: {
    title: "Suscripción cancelada",
    detail: "La operación del estudio está restringida.",
    tone: "blocked",
  },
  cancelled_period_end: {
    title: "Suscripción finalizada",
    detail: "El periodo contratado terminó y la operación está restringida hasta reactivar la suscripción.",
    tone: "blocked",
  },
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getAdminContext(undefined, { allowRestricted: true });
  const params = (await searchParams) ?? {};

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [{ data: billing }, { data: stripePrices }, { data: commercialPlans }] =
    await Promise.all([
      ctx.supabase
        .from("studio_plan_assignments")
        .select(
          "trial_started_at,next_billing_at,billing_provider,provider_customer_id,provider_subscription_id,provider_price_id",
        )
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      ctx.supabase
        .from("saas_plan_prices")
        .select("id,plan_id,billing_interval,currency,amount_minor,trial_days")
        .eq("provider", "stripe")
        .eq("currency", ctx.studio.currency.toLowerCase())
        .eq("active", true),
      ctx.supabase
        .from("saas_plans")
        .select("id,plan_key,name,description,sort_order")
        .eq("active", true)
        .eq("internal_only", false)
        .order("sort_order"),
    ]);

  const planById = new Map((commercialPlans ?? []).map((plan) => [plan.id, plan]));
  const availableStripePlans = (stripePrices ?? [])
    .map((price) => ({ price, plan: planById.get(price.plan_id) }))
    .filter((item) => Boolean(item.plan))
    .sort((left, right) => (left.plan?.sort_order ?? 0) - (right.plan?.sort_order ?? 0));
  const hasManagedStripeSubscription = Boolean(
    billing?.billing_provider === "stripe" &&
      billing.provider_subscription_id &&
      ctx.subscription.status !== "cancelled",
  );
  const billingError =
    typeof params.billing_error === "string" ? params.billing_error : null;
  const checkoutState =
    typeof params.checkout === "string" ? params.checkout : null;

  const state =
    statusCopy[ctx.subscription.effective_status] ??
    statusCopy[ctx.subscription.status] ??
    statusCopy.active;

  const cardClass =
    state.tone === "blocked"
      ? "border-red-500/40 bg-red-500/[0.06]"
      : state.tone === "warn"
        ? "border-amber-500/30 bg-amber-500/[0.05]"
        : "border-emerald-500/30 bg-emerald-500/[0.05]";

  return (
    <main className="dashboard-shell admin-ux04-secondary">
      <header className="topbar">
        <div>
          {ctx.subscription.access_mode === "full" ? (
            <Link className="back-link compact" href="/admin/mas">
              ← Más
            </Link>
          ) : null}
          <p className="eyebrow">STUDIO FLOW · SUSCRIPCIÓN</p>
          <h1 className="dashboard-title">Plan y suscripción</h1>
          <p>Consulta el estado operativo de {ctx.studio.name}.</p>
        </div>
      </header>

      <section className={`rounded-3xl border p-5 sm:p-6 ${cardClass}`}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Estado
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">{state.title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{state.detail}</p>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <p className="eyebrow">PLAN</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {ctx.subscription.plan_name}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Estado técnico: {ctx.subscription.status}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Acceso: {ctx.subscription.access_mode === "full" ? "Completo" : "Restringido"}
          </p>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <p className="eyebrow">PERIODO</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Trial inicia</dt>
              <dd className="text-right text-zinc-200">
                {formatDate(billing?.trial_started_at ?? null, ctx.studio.locale, ctx.studio.timezone)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Trial termina</dt>
              <dd className="text-right text-zinc-200">
                {formatDate(ctx.subscription.trial_ends_at, ctx.studio.locale, ctx.studio.timezone)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Periodo actual termina</dt>
              <dd className="text-right text-zinc-200">
                {formatDate(
                  ctx.subscription.current_period_end,
                  ctx.studio.locale,
                  ctx.studio.timezone,
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Gracia termina</dt>
              <dd className="text-right text-zinc-200">
                {formatDate(ctx.subscription.grace_ends_at, ctx.studio.locale, ctx.studio.timezone)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Próximo cobro</dt>
              <dd className="text-right text-zinc-200">
                {formatDate(billing?.next_billing_at ?? null, ctx.studio.locale, ctx.studio.timezone)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Facturación</dt>
              <dd className="text-right text-zinc-200">
                {billing?.billing_provider ?? "Manual / no configurada"}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      {billingError ? (
        <section className="mt-4 rounded-3xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm text-red-100">
          No pudimos abrir el cobro en este momento. Revisa la configuración de Stripe o intenta de nuevo.
        </section>
      ) : checkoutState === "success" ? (
        <section className="mt-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5 text-sm text-emerald-100">
          Pago enviado. El estado se actualizará automáticamente cuando Stripe confirme el evento.
        </section>
      ) : checkoutState === "cancelled" ? (
        <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.025] p-5 text-sm text-zinc-300">
          El checkout fue cancelado y no se cambió tu suscripción.
        </section>
      ) : null}

      <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">FACTURACIÓN AUTOMÁTICA</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Cobro de la suscripción</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Stripe procesa el pago. Studio Flow conserva el control del plan, los límites y el
              acceso operativo.
            </p>
          </div>

          {billing?.billing_provider === "stripe" && billing.provider_customer_id ? (
            <form action={openStripePortalAction}>
              <button
                type="submit"
                className="rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Administrar cobro
              </button>
            </form>
          ) : null}
        </div>

        {!hasManagedStripeSubscription && availableStripePlans.length ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {availableStripePlans.map(({ price, plan }) => (
              <article
                key={price.id}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-base font-semibold text-white">{plan?.name}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{plan?.description}</p>
                <p className="mt-4 text-2xl font-semibold text-white">
                  {formatMoney(price.amount_minor, price.currency, ctx.studio.locale)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  por {price.billing_interval === "year" ? "año" : "mes"}
                  {price.trial_days > 0 ? ` · ${price.trial_days} días de prueba` : ""}
                </p>
                <form action={startStripeCheckoutAction} className="mt-4">
                  <input type="hidden" name="plan_key" value={plan?.plan_key ?? ""} />
                  <input
                    type="hidden"
                    name="billing_interval"
                    value={price.billing_interval}
                  />
                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Elegir {plan?.name}
                  </button>
                </form>
              </article>
            ))}
          </div>
        ) : !hasManagedStripeSubscription ? (
          <p className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
            El motor de cobro está listo. Falta vincular los precios comerciales de Stripe para
            habilitar el checkout.
          </p>
        ) : (
          <p className="mt-5 text-sm text-zinc-400">
            Tu suscripción ya está vinculada con Stripe. Usa “Administrar cobro” para gestionar el
            método de pago, facturación o cancelación.
          </p>
        )}
      </section>

      {ctx.subscription.cancel_at_period_end ? (
        <section className="notice mt-4">
          La cancelación está programada para el final del periodo actual. Hasta entonces el acceso
          permanece activo.
        </section>
      ) : null}

      {ctx.subscription.access_mode === "restricted" ? (
        <section className="panel mt-4">
          <p className="eyebrow">ACCESO RESTRINGIDO</p>
          <h2>La operación está pausada</h2>
          <p>
            Mientras la suscripción esté restringida, alumnas, coaches y herramientas operativas no
            pueden usarse. El owner conserva acceso a esta pantalla para revisar el estado.
          </p>
        </section>
      ) : null}
    </main>
  );
}
