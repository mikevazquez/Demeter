import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { BillingPanel } from "./BillingPanel";
import "./subscription-v2.css";

function formatDate(value: string | null, locale: string, timeZone: string) {
  if (!value) return "No configurado";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value));
}

const statusCopy: Record<
  string,
  { title: string; detail: string; tone: "ok" | "warn" | "blocked" }
> = {
  active: {
    title: "Suscripción activa",
    detail: "El estudio tiene acceso operativo completo.",
    tone: "ok",
  },
  trialing: {
    title: "Periodo de prueba",
    detail: "El estudio conserva acceso mientras la prueba siga vigente.",
    tone: "warn",
  },
  past_due: {
    title: "Pago pendiente",
    detail: "Revisa el estado de facturación del estudio.",
    tone: "warn",
  },
  suspended: {
    title: "Suscripción suspendida",
    detail: "La suscripción requiere atención.",
    tone: "blocked",
  },
  cancelled: {
    title: "Suscripción cancelada",
    detail: "La suscripción está cancelada.",
    tone: "blocked",
  },
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ billing_error?: string; checkout?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: assignment, error: assignmentError } = await ctx.supabase
    .from("studio_plan_assignments")
    .select(
      "plan_id,status,starts_at,ends_at,trial_ends_at,current_period_start,current_period_end,grace_ends_at,cancel_at_period_end,billing_provider,provider_customer_id,provider_subscription_id,next_billing_at",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  const { data: plan, error: planError } = assignment?.plan_id
    ? await ctx.supabase
        .from("saas_plans")
        .select("id,plan_key,name,description,internal_only")
        .eq("id", assignment.plan_id)
        .maybeSingle()
    : { data: null, error: null };

  const unavailable = Boolean(assignmentError || planError || !assignment || !plan);
  const status = assignment?.status;
  const state =
    !unavailable && status && statusCopy[status]
      ? statusCopy[status]
      : {
          title: "Estado no disponible",
          detail: "No pudimos confirmar la suscripción. Intenta nuevamente.",
          tone: "warn",
        };
  const [
    { data: prices, error: pricesError },
    { data: commercialPlans, error: plansError },
    { data: usage, error: usageError },
  ] = await Promise.all([
    ctx.supabase
      .from("saas_plan_prices")
      .select("id,plan_id,billing_interval,currency,amount_minor")
      .eq("provider", "stripe")
      .eq("active", true)
      .eq("currency", ctx.studio.currency.toLowerCase()),
    ctx.supabase
      .from("saas_plans")
      .select("id,plan_key,name")
      .eq("active", true)
      .eq("internal_only", false),
    ctx.supabase.rpc("current_studio_plan_usage", { p_studio_id: ctx.studio.id }),
  ]);

  return (
    <main className="subscription-v2">
      <header className="subscription-v2-header">
        <Link className="subscription-v2-back" href="/admin/mas">
          ← Más
        </Link>
        <h1>Plan y suscripción</h1>
        <p>Consulta el plan actual y la información de facturación del estudio.</p>
      </header>

      <section
        className={`subscription-v2-status${state.tone === "warn" ? " is-warn" : state.tone === "blocked" ? " is-blocked" : ""}`}
      >
        <span>ESTADO</span>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
      </section>

      {params.error === "plan_access" ? (
        <p className="notice" role="status">
          Esta función no está disponible en tu plan o estado de suscripción actual.
        </p>
      ) : null}
      {params.billing_error ? (
        <p className="notice error" role="alert">
          No pudimos abrir el servicio de cobro. Intenta nuevamente.
        </p>
      ) : null}
      {params.checkout === "success" ? (
        <p className="notice" role="status">
          Recibimos tu regreso del pago. La suscripción se actualizará cuando se confirme el cobro.
        </p>
      ) : null}
      {params.checkout === "cancelled" ? (
        <p className="notice" role="status">
          Saliste del proceso de pago.
        </p>
      ) : null}
      <section className="subscription-v2-grid">
        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Plan actual</h2>
            <p>Configuración comercial asignada a este estudio.</p>
          </div>
          <strong className="subscription-v2-plan-name">{plan?.name ?? "Studio Flow"}</strong>
          <p className="subscription-v2-muted">
            {plan?.description ?? "Plan configurado para este estudio."}
          </p>
          <dl className="subscription-v2-list">
            <div>
              <dt>Inicio</dt>
              <dd>
                {formatDate(assignment?.starts_at ?? null, ctx.studio.locale, ctx.studio.timezone)}
              </dd>
            </div>
            <div>
              <dt>Fin del periodo</dt>
              <dd>
                {formatDate(
                  assignment?.current_period_end ?? assignment?.ends_at ?? null,
                  ctx.studio.locale,
                  ctx.studio.timezone,
                )}
              </dd>
            </div>
            <div>
              <dt>Próximo cobro</dt>
              <dd>
                {formatDate(
                  assignment?.next_billing_at ?? null,
                  ctx.studio.locale,
                  ctx.studio.timezone,
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Facturación</h2>
            <p>Información del proveedor de cobro, sin intervenir en el acceso.</p>
          </div>
          <dl className="subscription-v2-list">
            <div>
              <dt>Proveedor</dt>
              <dd>
                {assignment?.billing_provider === "stripe"
                  ? "Stripe"
                  : "Administrado por Studio Flow"}
              </dd>
            </div>
            <div>
              <dt>Cliente vinculado</dt>
              <dd>{assignment?.provider_customer_id ? "Sí" : "No"}</dd>
            </div>
            <div>
              <dt>Suscripción vinculada</dt>
              <dd>{assignment?.provider_subscription_id ? "Sí" : "No"}</dd>
            </div>
            <div>
              <dt>Cancelar al final</dt>
              <dd>{assignment?.cancel_at_period_end ? "Sí" : "No"}</dd>
            </div>
          </dl>
          <div className="subscription-v2-connected">
            La pantalla de suscripción es informativa y no controla el inicio de sesión ni el acceso
            al panel.
          </div>
        </article>
      </section>
      <section className="subscription-v2-card">
        <div className="subscription-v2-card-heading">
          <h2>Límites y uso</h2>
          <p>Consumo actual de los límites de tu plan.</p>
        </div>
        {usageError ? (
          <p role="status">No pudimos consultar el uso del plan. Intenta nuevamente.</p>
        ) : (
          <dl className="subscription-v2-list">
            {(usage ?? []).map(
              (item: {
                limit_key: string;
                limit_name: string;
                usage: number;
                limit_value: number | null;
                unlimited: boolean;
                note: string | null;
              }) => (
                <div key={item.limit_key}>
                  <dt>{item.limit_name}</dt>
                  <dd>
                    {item.usage} / {item.unlimited ? "Sin límite" : item.limit_value}
                    {item.note ? ` · ${item.note}` : ""}
                  </dd>
                </div>
              ),
            )}
          </dl>
        )}
      </section>
      <BillingPanel
        plans={commercialPlans ?? []}
        prices={prices ?? []}
        locale={ctx.studio.locale}
        hasCustomer={
          assignment?.billing_provider === "stripe" && Boolean(assignment.provider_customer_id)
        }
        hasSubscription={
          assignment?.billing_provider === "stripe" &&
          Boolean(assignment.provider_subscription_id) &&
          assignment.status !== "cancelled"
        }
        internalPlan={plan?.internal_only === true}
        unavailable={unavailable || Boolean(pricesError || plansError)}
      />
    </main>
  );
}
