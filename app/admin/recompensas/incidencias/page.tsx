import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { EmptyState, StatusBadge, formatDateTime, incidentPriorityLabels } from "../ui";

export default async function RewardIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  let request = ctx.supabase
    .from("reward_incidents")
    .select("id,student_id,rule_id,reward_instance_id,incident_type,priority,status,summary,opened_at,updated_at")
    .eq("studio_id", ctx.studio.id)
    .order("opened_at", { ascending: false });

  if (query.status) request = request.eq("status", query.status);
  if (query.priority) request = request.eq("priority", query.priority);

  const { data: incidents } = await request;
  const studentIds = [...new Set((incidents ?? []).map((item) => item.student_id).filter(Boolean))] as string[];
  const { data: students } = studentIds.length
    ? await ctx.supabase.from("students").select("id,full_name").in("id", studentIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));

  const critical = (incidents ?? []).filter((item) => item.priority === "critical" && item.status !== "closed").length;
  const inReview = (incidents ?? []).filter((item) => item.status === "in_review").length;

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link href="/admin/recompensas" className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white">← Recompensas</Link>
        <p className="eyebrow">INCIDENCIAS</p>
        <h1 className="dashboard-title">Bandeja de incidencias</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          Vista operativa de anomalías y correcciones. Las acciones de resolución se habilitarán al cerrar SF-243; aquí no se reescribe historial.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-zinc-500">Abiertas</p><strong className="mt-2 block text-2xl text-white">{(incidents ?? []).filter((item) => item.status !== "closed").length}</strong></div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-4"><p className="text-xs text-rose-300">Críticas</p><strong className="mt-2 block text-2xl text-white">{critical}</strong></div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><p className="text-xs text-amber-300">En revisión</p><strong className="mt-2 block text-2xl text-white">{inReview}</strong></div>
      </section>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[auto_auto_auto] md:justify-start">
        <select name="status" defaultValue={query.status ?? ""} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white">
          <option value="">Todos los estados</option>
          <option value="detected">Detectada</option>
          <option value="in_review">En revisión</option>
          <option value="resolved_automatic">Resuelta automáticamente</option>
          <option value="resolved_manual">Resuelta manualmente</option>
          <option value="no_action_required">Sin acción requerida</option>
          <option value="closed">Cerrada</option>
        </select>
        <select name="priority" defaultValue={query.priority ?? ""} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white">
          <option value="">Todas las prioridades</option>
          <option value="critical">Crítica</option>
          <option value="high">Alta</option>
          <option value="normal">Normal</option>
        </select>
        <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white">Filtrar</button>
      </form>

      {!(incidents ?? []).length ? (
        <EmptyState title="No hay incidencias con esos filtros" />
      ) : (
        <section className="grid gap-3">
          {(incidents ?? []).map((incident) => (
            <Link key={incident.id} href={`/admin/recompensas/incidencias/${incident.id}`} className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/35 lg:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={incident.priority === "critical" ? "rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300" : incident.priority === "high" ? "rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300" : "rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs font-semibold text-zinc-300"}>
                    {incidentPriorityLabels[incident.priority] ?? incident.priority}
                  </span>
                  <StatusBadge status={incident.status} />
                </div>
                <h2 className="mt-2 text-base font-semibold text-white">{incident.summary}</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {studentMap.get(incident.student_id ?? "") ?? "Contexto de sistema"} · {incident.incident_type}
                </p>
              </div>
              <div className="text-xs text-zinc-500 lg:text-right">
                <p>Abierta {formatDateTime(incident.opened_at)}</p>
                <p className="mt-1">Actualizada {formatDateTime(incident.updated_at)}</p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
