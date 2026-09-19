import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  EmptyState,
  StatusBadge,
  asObject,
  formatDateTime,
  incidentPriorityLabels,
  rewardDefinitionLabel,
} from "../../ui";

export default async function RewardIncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const { data: incident } = await ctx.supabase
    .from("reward_incidents")
    .select("*")
    .eq("studio_id", ctx.studio.id)
    .eq("id", incidentId)
    .maybeSingle();

  if (!incident) notFound();

  const [{ data: student }, { data: rule }, { data: reward }, { data: events }] = await Promise.all(
    [
      incident.student_id
        ? ctx.supabase
            .from("students")
            .select("id,full_name,email")
            .eq("id", incident.student_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      incident.rule_id
        ? ctx.supabase
            .from("reward_rules")
            .select("id,current_version_number,status")
            .eq("id", incident.rule_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      incident.reward_instance_id
        ? ctx.supabase
            .from("reward_instances")
            .select("*")
            .eq("id", incident.reward_instance_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      ctx.supabase
        .from("reward_incident_events")
        .select("*")
        .eq("incident_id", incident.id)
        .order("occurred_at", { ascending: true }),
    ],
  );

  const { data: version } = rule
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("name,human_summary")
        .eq("rule_id", rule.id)
        .eq("version_number", rule.current_version_number)
        .maybeSingle()
    : { data: null };

  const details = asObject(incident.details);
  const resolution = asObject(incident.resolution);

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link
          href="/admin/recompensas/incidencias"
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Incidencias
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">DETALLE DE INCIDENCIA</p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-white">
              {incident.summary}
            </h1>
            <p className="mt-3 text-sm text-zinc-400">
              {student?.full_name ?? "Contexto de sistema"}
              {version?.name ? ` · ${version.name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={
                incident.priority === "critical"
                  ? "rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300"
                  : "rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300"
              }
            >
              {incidentPriorityLabels[incident.priority] ?? incident.priority}
            </span>
            <StatusBadge status={incident.status} />
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
        <strong className="text-sm text-amber-200">Resolución controlada por SF-243</strong>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Esta pantalla ya expone el contexto y la evidencia. No habilitamos acciones manuales antes
          de cerrar el motor de recálculo, revocación y auditoría.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            CONTEXTO
          </p>
          <div className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Tipo</span>
              <strong className="text-right text-white">{incident.incident_type}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Abierta</span>
              <strong className="text-right text-white">
                {formatDateTime(incident.opened_at)}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Alumna</span>
              <strong className="text-right text-white">{student?.full_name ?? "—"}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Regla</span>
              <strong className="text-right text-white">{version?.name ?? "—"}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Recompensa</span>
              <strong className="text-right text-white">
                {reward ? rewardDefinitionLabel(reward.benefit_definition) : "—"}
              </strong>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            IMPACTO Y EVIDENCIA
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-zinc-300">
            {JSON.stringify(details, null, 2)}
          </pre>
          {Object.keys(resolution).length ? (
            <>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                RESOLUCIÓN REGISTRADA
              </p>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-zinc-300">
                {JSON.stringify(resolution, null, 2)}
              </pre>
            </>
          ) : null}
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
          TIMELINE
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">Historial de la incidencia</h2>
        <div className="mt-5 grid gap-2">
          {!(events ?? []).length ? (
            <EmptyState title="Aún no hay eventos de resolución" />
          ) : (
            (events ?? []).map((event) => (
              <div key={event.id} className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-white">{event.action}</strong>
                  <span className="text-xs text-zinc-500">{formatDateTime(event.occurred_at)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {event.from_status ?? "inicio"} → {event.to_status}
                  {event.reason ? ` · ${event.reason}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
