import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

import { openStripePortalAction, startStripeCheckoutAction } from "./actions";
import "./subscription-v2.css";

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
    detail: "El estudio conserva acceso completo mientras el periodo de prueba siga vigente.",
    tone: "warn",
  },
  trial_expired: {
    title: "Periodo de prueba vencido",
    detail: "La operación está restringida hasta activar una suscripción.",
    tone: "blocked",
  },
  past_due_grace: {
    title: "Pago pendiente",
    detail: "El estudio conserva acceso temporalmente durante el periodo de gracia.",
    tone: "warn",
  },
  past_due_expired: {
    title: "Pago pendiente · acceso restringido",
    detail: "El periodo de gracia terminó. Regulariza la suscripción para recuperar el acceso.",
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
    detail: "El periodo contratado terminó y la operación está restringida hasta reactivarla.",
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

  return (
    <main className="subscription-v2">
      <header className="subscription-v2-header">
        <div>
          {ctx.subscription.access_mode === "full" ? (
            <Link className="subscription-v2-back" href="/admin/configuracion">
              ← Avanzado
            </Link>
          ) : null}
          <h1>Plan y suscripción</h1>
          <p>Consulta el plan, periodo y facturación de {ctx.studio.name}.</p>
        </div>
      </header>

      <section className={`subscription-v2-status is-${state.tone}`}>
        <span>ESTADO</span>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
      </section>

      {billingError ? (
        <div className="subscription-v2-notice is-error">
          No pudimos abrir el cobro. Revisa la configuración o intenta nuevamente.
        </div>
      ) : checkoutState === "success" ? (
        <div className="subscription-v2-notice is-success">
          Pago enviado. El estado se actualizará cuando Stripe confirme el evento.
        </div>
      ) : checkoutState === "cancelled" ? (
        <div className="subscription-v2-notice">El checkout fue cancelado y no hubo cambios.</div>
      ) : null}

      <section className="subscription-v2-grid">
        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Plan actual</h2>
          </div>
          <div className="subscription-v2-plan-name">{ctx.subscription.plan_name}</div>
          <dl className="subscription-v2-list">
            <div>
              <dt>Acceso</dt>
              <dd>{ctx.subscription.access_mode === "full" ? "Completo" : "Restringido"}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>{ctx.subscription.status}</dd>
            </div>
            <div>
              <dt>Facturación</dt>
              <dd>{billing?.billing_provider ?? "Manual / no configurada"}</dd>
            </div>
          </dl>
        </article>

        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Fechas importantes</h2>
          </div>
          <dl className="subscription-v2-list">
            <div>
              <dt>Inicio de prueba</dt>
              <dd>{formatDate(billing?.trial_started_at ?? null, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div>
              <dt>Fin de prueba</dt>
              <dd>{formatDate(ctx.subscription.trial_ends_at, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div>
              <dt>Fin del periodo</dt>
              <dd>{formatDate(ctx.subscription.current_period_end, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div>
              <dt>Fin de gracia</dt>
              <dd>{formatDate(ctx.subscription.grace_ends_at, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div>
              <dt>Próximo cobro</dt>
              <dd>{formatDate(billing?.next_billing_at ?? null, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="subscription-v2-card">
        <div className="subscription-v2-card-heading subscription-v2-billing-heading">
          <div>
            <h2>Facturación</h2>
            <p>Stripe procesa el pago; Studio Flow conserva el control del plan y acceso.</p>
          </div>

          {billing?.billing_provider === "stripe" && billing.provider_customer_id ? (
            <form action={openStripePortalAction}>
              <button className="subscription-v2-secondary" type="submit">
                Administrar cobro
              </button>
            </form>
          ) : null}
        </div>

        {!hasManagedStripeSubscription && availableStripePlans.length ? (
          <div className="subscription-v2-plans">
            {availableStripePlans.map(({ price, plan }) => (
              <article key={price.id} className="subscription-v2-plan-option">
                <strong>{plan?.name}</strong>
                <p>{plan?.description}</p>
                <div className="subscription-v2-price">
                  {formatMoney(price.amount_minor, price.currency, ctx.studio.locale)}
                </div>
                <small>
                  por {price.billing_interval === "year" ? "año" : "mes"}
                  {price.trial_days > 0 ? ` · ${price.trial_days} días de prueba` : ""}
                </small>
                <form action={startStripeCheckoutAction}>
                  <input type="hidden" name="plan_key" value={plan?.plan_key ?? ""} />
                  <input type="hidden" name="billing_interval" value={price.billing_interval} />
                  <button className="subscription-v2-primary" type="submit">
                    Elegir {plan?.name}
                  </button>
                </form>
              </article>
            ))}
          </div>
        ) : !hasManagedStripeSubscription ? (
          <div className="subscription-v2-empty">
            El motor de cobro está listo. Falta vincular precios comerciales de Stripe para habilitar el checkout.
          </div>
        ) : (
          <div className="subscription-v2-connected">
            Suscripción vinculada con Stripe. Usa “Administrar cobro” para método de pago, facturación o cancelación.
          </div>
        )}
      </section>

      {ctx.subscription.cancel_at_period_end ? (
        <div className="subscription-v2-notice">
          La cancelación está programada para el final del periodo actual. Hasta entonces el acceso permanece activo.
        </div>
      ) : null}

      {ctx.subscription.access_mode === "restricted" ? (
        <section className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Acceso restringido</h2>
          </div>
          <p className="subscription-v2-muted">
            Mientras la suscripción esté restringida, la operación diaria queda pausada. El owner conserva acceso a esta pantalla para revisar el estado y regularizar el plan.
          </p>
        </section>
      ) : null}
    </main>
  );
}
