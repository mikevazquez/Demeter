import { openStripePortalAction, startStripeCheckoutAction } from "./actions";

type BillingPlan = { id: string; plan_key: string; name: string };
type BillingPrice = {
  id: string;
  plan_id: string;
  billing_interval: string;
  currency: string;
  amount_minor: number;
};

export function BillingPanel({
  plans,
  prices,
  locale,
  hasSubscription,
  hasCustomer,
  internalPlan,
  unavailable,
}: {
  plans: BillingPlan[];
  prices: BillingPrice[];
  locale: string;
  hasSubscription: boolean;
  hasCustomer: boolean;
  internalPlan: boolean;
  unavailable: boolean;
}) {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const available = prices.flatMap((price) => {
    const plan = planById.get(price.plan_id);
    return plan ? [{ price, plan }] : [];
  });

  return (
    <section className="subscription-v2-card">
      <div className="subscription-v2-card-heading">
        <h2>Cobro de la suscripción</h2>
        <p>Consulta tus opciones de pago y administra tu facturación.</p>
      </div>
      {unavailable ? (
        <p role="status">La información de cobro no está disponible. Intenta nuevamente.</p>
      ) : internalPlan ? (
        <p>Este plan interno es administrado por Studio Flow.</p>
      ) : (
        <>
          {hasCustomer ? (
            <form action={openStripePortalAction}>
              <button type="submit" className="primary-button">
                Administrar cobro
              </button>
            </form>
          ) : null}
          {hasSubscription ? (
            <p>Administra tu método de pago, facturas y cancelación desde el portal de cobro.</p>
          ) : available.length ? (
            <div className="subscription-v2-grid">
              {available.map(({ price, plan }) => (
                <article key={price.id} className="subscription-v2-card">
                  <h3>{plan.name}</h3>
                  <p>
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: price.currency.toUpperCase(),
                    }).format(price.amount_minor / 100)}
                    {price.billing_interval === "year" ? " / año" : " / mes"}
                  </p>
                  <form action={startStripeCheckoutAction}>
                    <input type="hidden" name="plan_key" value={plan.plan_key} />
                    <input type="hidden" name="billing_interval" value={price.billing_interval} />
                    <button type="submit" className="primary-button">
                      Elegir {plan.name}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <p>La contratación en línea todavía no está habilitada para este estudio.</p>
          )}
        </>
      )}
    </section>
  );
}
