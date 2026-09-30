import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import "./subscription-v2.css";

function formatDate(value: string | null, locale: string, timeZone: string) {
  if (!value) return "No configurado";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value));
}

const statusCopy: Record<string, { title: string; detail: string; tone: "ok" | "warn" | "blocked" }> = {
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

export default async function SubscriptionPage() {
  const ctx = await getAdminContext();

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: assignment } = await ctx.supabase
    .from("studio_plan_assignments")
    .select("plan_id,status,starts_at,ends_at,trial_ends_at,current_period_start,current_period_end,grace_ends_at,cancel_at_period_end,billing_provider,provider_customer_id,provider_subscription_id,next_billing_at")
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  const { data: plan } = assignment?.plan_id
    ? await ctx.supabase
        .from("saas_plans")
        .select("id,plan_key,name,description")
        .eq("id", assignment.plan_id)
        .maybeSingle()
    : { data: null };

  const status = assignment?.status ?? "active";
  const state = statusCopy[status] ?? statusCopy.active;

  return (
    <main className="subscription-v2">
      <header className="subscription-v2-header">
        <Link className="subscription-v2-back" href="/admin/mas">← Más</Link>
        <h1>Plan y suscripción</h1>
        <p>Consulta el plan actual y la información de facturación del estudio.</p>
      </header>

      <section className={`subscription-v2-status${state.tone === "warn" ? " is-warn" : state.tone === "blocked" ? " is-blocked" : ""}`}>
        <span>ESTADO</span>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
      </section>

      <section className="subscription-v2-grid">
        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Plan actual</h2>
            <p>Configuración comercial asignada a este estudio.</p>
          </div>
          <strong className="subscription-v2-plan-name">{plan?.name ?? "Studio Flow"}</strong>
          <p className="subscription-v2-muted">{plan?.description ?? "Plan configurado para este estudio."}</p>
          <dl className="subscription-v2-list">
            <div><dt>Inicio</dt><dd>{formatDate(assignment?.starts_at ?? null, ctx.studio.locale, ctx.studio.timezone)}</dd></div>
            <div><dt>Fin del periodo</dt><dd>{formatDate(assignment?.current_period_end ?? assignment?.ends_at ?? null, ctx.studio.locale, ctx.studio.timezone)}</dd></div>
            <div><dt>Próximo cobro</dt><dd>{formatDate(assignment?.next_billing_at ?? null, ctx.studio.locale, ctx.studio.timezone)}</dd></div>
          </dl>
        </article>

        <article className="subscription-v2-card">
          <div className="subscription-v2-card-heading">
            <h2>Facturación</h2>
            <p>Información del proveedor de cobro, sin intervenir en el acceso.</p>
          </div>
          <dl className="subscription-v2-list">
            <div><dt>Proveedor</dt><dd>{assignment?.billing_provider === "stripe" ? "Stripe" : "Administrado por Studio Flow"}</dd></div>
            <div><dt>Cliente vinculado</dt><dd>{assignment?.provider_customer_id ? "Sí" : "No"}</dd></div>
            <div><dt>Suscripción vinculada</dt><dd>{assignment?.provider_subscription_id ? "Sí" : "No"}</dd></div>
            <div><dt>Cancelar al final</dt><dd>{assignment?.cancel_at_period_end ? "Sí" : "No"}</dd></div>
          </dl>
          <div className="subscription-v2-connected">
            La pantalla de suscripción es informativa y no controla el inicio de sesión ni el acceso al panel.
          </div>
        </article>
      </section>
    </main>
  );
}
