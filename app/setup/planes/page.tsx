import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  changeStudioPlanAction,
  changeStudioSubscriptionAction,
} from "./actions";

type PlanRow = {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  internal_only: boolean;
  sort_order: number;
};

type SubscriptionRow = {
  plan_key: string;
  plan_name: string;
  status: string;
  effective_status: string;
  access_mode: "full" | "restricted";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  suspended_at: string | null;
  last_payment_failure_at: string | null;
  billing_provider: string | null;
};

type PlanUsageRow = {
  plan_key: string;
  plan_name: string;
  limit_key: string;
  limit_name: string;
  unit: string;
  limit_value: number | null;
  usage: number;
  unlimited: boolean;
  over_limit: boolean;
  remaining: number | null;
  note: string | null;
};

export default async function PlatformPlansPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    studio?: string;
    plan?: string;
    subscription_saved?: string;
    subscription_status?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!platformAdmin) redirect("/");

  const [
    { data: studios },
    { data: plans },
    { data: assignments },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("studios")
      .select("id,name,slug,status")
      .order("name"),
    supabase
      .from("saas_plans")
      .select("id,plan_key,name,description,internal_only,sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("studio_plan_assignments")
      .select(
        "studio_id,plan_id,status,starts_at,metadata,updated_at,trial_ends_at,current_period_start,current_period_end,grace_ends_at,cancel_at_period_end,cancelled_at,suspended_at,last_payment_failure_at,billing_provider",
      ),
    supabase
      .from("studio_plan_assignment_events")
      .select(
        "id,studio_id,from_plan_id,to_plan_id,from_status,to_status,source,reason,occurred_at",
      )
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);

  const planRows = (plans ?? []) as PlanRow[];
  const [usageEntries, subscriptionEntries] = await Promise.all([
    Promise.all(
      (studios ?? []).map(async (studio) => {
        const { data } = await supabase.rpc("current_studio_plan_usage", {
          p_studio_id: studio.id,
        });
        return [studio.id, (data ?? []) as PlanUsageRow[]] as const;
      }),
    ),
    Promise.all(
      (studios ?? []).map(async (studio) => {
        const { data } = await supabase.rpc("current_studio_subscription", {
          p_studio_id: studio.id,
        });
        return [
          studio.id,
          (((data ?? [])[0] ?? null) as SubscriptionRow | null),
        ] as const;
      }),
    ),
  ]);
  const usageByStudio = new Map(usageEntries);
  const subscriptionByStudio = new Map(subscriptionEntries);
  const planById = new Map(planRows.map((plan) => [plan.id, plan]));
  const assignmentByStudio = new Map(
    (assignments ?? []).map((assignment) => [assignment.studio_id, assignment]),
  );
  const studioById = new Map((studios ?? []).map((studio) => [studio.id, studio]));

  return (
    <main className="dashboard-shell admin-ux04-secondary">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/setup">
            ← Crear estudio
          </Link>
          <p className="eyebrow">STUDIO FLOW · PLATAFORMA</p>
          <h1 className="dashboard-title">Planes por estudio</h1>
          <p>
            Asigna o cambia el plan comercial de cada tenant. Cada cambio queda registrado.
          </p>
        </div>
      </header>

      {params.saved === "1" ? (
        <div className="notice success">
          Plan actualizado{params.plan ? ` a ${params.plan}` : ""}.
        </div>
      ) : null}

      {params.subscription_saved === "1" ? (
        <div className="notice success">
          Estado de suscripción actualizado
          {params.subscription_status ? ` a ${params.subscription_status}` : ""}.
        </div>
      ) : null}

      {params.saved === "unchanged" ? (
        <div className="notice">
          Ese estudio ya tiene el plan seleccionado. No se realizaron cambios.
        </div>
      ) : null}

      {params.error ? (
        <div className="notice error">
          {params.error === "invalid_plan"
            ? "Selecciona un plan válido."
            : params.error === "invalid_request"
              ? "Faltan datos para cambiar el plan."
              : params.error === "invalid_subscription"
                ? "Revisa el estado y las fechas de la suscripción."
                : params.error === "cancel_period_required"
                  ? "Para cancelar al final del periodo debes indicar cuándo termina."
                  : params.error === "assignment_missing"
                    ? "Ese estudio todavía no tiene una asignación de plan."
                    : params.error === "subscription_save_failed"
                      ? "No pudimos guardar el estado de suscripción."
                      : "No pudimos guardar el cambio de plan."}
        </div>
      ) : null}

      <section className="grid gap-3">
        {(studios ?? []).map((studio) => {
          const assignment = assignmentByStudio.get(studio.id);
          const currentPlan = assignment ? planById.get(assignment.plan_id) : null;
          const usageRows = usageByStudio.get(studio.id) ?? [];
          const subscription = subscriptionByStudio.get(studio.id);

          const toDateTimeLocal = (value: string | null | undefined) =>
            value ? value.slice(0, 16) : "";

          return (
            <article
              key={studio.id}
              className="rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {studio.slug}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{studio.name}</h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    Plan actual:{" "}
                    <strong className="text-fuchsia-300">
                      {currentPlan?.name ?? "Sin plan"}
                    </strong>
                    {currentPlan?.internal_only ? " · interno" : ""}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {assignment?.status ?? studio.status}
                </span>
              </div>

              {usageRows.length ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {usageRows.map((row) => (
                    <div
                      key={row.limit_key}
                      className={`rounded-2xl border px-3 py-2.5 ${
                        row.over_limit
                          ? "border-red-500/40 bg-red-500/5"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        {row.limit_name}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {row.usage}{" "}
                        <span className="text-xs font-normal text-zinc-500">
                          / {row.unlimited ? "∞" : row.limit_value}
                        </span>
                      </p>
                      {row.over_limit ? (
                        <p className="mt-1 text-[10px] font-semibold text-red-300">
                          Sobre cuota
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <section className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Suscripción
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {subscription?.effective_status ?? assignment?.status ?? "Sin estado"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      subscription?.access_mode === "restricted"
                        ? "border-red-500/40 text-red-300"
                        : "border-emerald-500/30 text-emerald-300"
                    }`}
                  >
                    {subscription?.access_mode === "restricted" ? "Restringido" : "Operativo"}
                  </span>
                </div>

                <form action={changeStudioSubscriptionAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="studio_id" value={studio.id} />

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label>
                      Estado
                      <select
                        name="status"
                        defaultValue={assignment?.status ?? "active"}
                        required
                      >
                        <option value="trialing">Trial</option>
                        <option value="active">Activo</option>
                        <option value="past_due">Pago vencido</option>
                        <option value="suspended">Suspendido</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </label>

                    <label>
                      Fin de trial · UTC
                      <input
                        name="trial_ends_at"
                        type="datetime-local"
                        defaultValue={toDateTimeLocal(assignment?.trial_ends_at)}
                      />
                    </label>

                    <label>
                      Fin de gracia · UTC
                      <input
                        name="grace_ends_at"
                        type="datetime-local"
                        defaultValue={toDateTimeLocal(assignment?.grace_ends_at)}
                      />
                    </label>

                    <label>
                      Fin de periodo · UTC
                      <input
                        name="current_period_end"
                        type="datetime-local"
                        defaultValue={toDateTimeLocal(assignment?.current_period_end)}
                      />
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      name="cancel_at_period_end"
                      type="checkbox"
                      defaultChecked={assignment?.cancel_at_period_end === true}
                    />
                    Cancelar al finalizar el periodo actual
                  </label>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <label>
                      Motivo
                      <input
                        name="billing_reason"
                        placeholder="Pago fallido, reactivación, cancelación…"
                        maxLength={240}
                      />
                    </label>
                    <button className="primary-button self-end" type="submit">
                      Guardar estado
                    </button>
                  </div>
                </form>
              </section>

              <form action={changeStudioPlanAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="studio_id" value={studio.id} />
                <label>
                  Nuevo plan
                  <select
                    name="plan_id"
                    defaultValue={assignment?.plan_id ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Selecciona un plan
                    </option>
                    {planRows.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                        {plan.internal_only ? " · interno" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Motivo
                  <input
                    name="reason"
                    placeholder="Alta, upgrade, downgrade, piloto…"
                    maxLength={240}
                  />
                </label>

                <button className="primary-button self-end" type="submit">
                  Guardar plan
                </button>
              </form>
            </article>
          );
        })}
      </section>

      <section className="panel mt-5">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">HISTORIAL</p>
            <h2>Últimos cambios de plan</h2>
          </div>
        </div>

        {(events ?? []).length ? (
          <div className="grid gap-2">
            {(events ?? []).map((event) => {
              const studio = studioById.get(event.studio_id);
              const fromPlan = event.from_plan_id
                ? planById.get(event.from_plan_id)
                : null;
              const toPlan = planById.get(event.to_plan_id);

              return (
                <div
                  key={event.id}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-white">
                      {studio?.name ?? event.studio_id}
                    </strong>
                    <span className="text-[11px] text-zinc-500">
                      {new Intl.DateTimeFormat("es-MX", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "America/Mexico_City",
                      }).format(new Date(event.occurred_at))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {fromPlan?.name ?? "Sin plan"} → {toPlan?.name ?? "Plan"}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                    {event.source}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Todavía no hay cambios registrados.</p>
        )}
      </section>
    </main>
  );
}
