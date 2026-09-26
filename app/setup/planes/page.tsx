import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { changeStudioPlanAction } from "./actions";

type PlanRow = {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  internal_only: boolean;
  sort_order: number;
};

export default async function PlatformPlansPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    studio?: string;
    plan?: string;
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
      .select("studio_id,plan_id,status,starts_at,metadata,updated_at"),
    supabase
      .from("studio_plan_assignment_events")
      .select(
        "id,studio_id,from_plan_id,to_plan_id,from_status,to_status,source,reason,occurred_at",
      )
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);

  const planRows = (plans ?? []) as PlanRow[];
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
              : "No pudimos guardar el cambio de plan."}
        </div>
      ) : null}

      <section className="grid gap-3">
        {(studios ?? []).map((studio) => {
          const assignment = assignmentByStudio.get(studio.id);
          const currentPlan = assignment ? planById.get(assignment.plan_id) : null;

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
