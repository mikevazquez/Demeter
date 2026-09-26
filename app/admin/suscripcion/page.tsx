import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

function formatDate(value: string | null, locale: string, timeZone: string) {
  if (!value) return "No configurado";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
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
};

export default async function SubscriptionPage() {
  const ctx = await getAdminContext(undefined, { allowRestricted: true });

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

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
          </dl>
        </article>
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
