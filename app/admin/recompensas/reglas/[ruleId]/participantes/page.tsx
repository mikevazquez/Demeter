import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { EmptyState, StatusBadge, formatDateTime, progressSummary } from "../../../ui";

type RewardParticipantCycleRow = {
  id: string;
  student_id: string;
  status: string;
  window_end_at: string | null;
  updated_at: string;
};

type RewardParticipantSnapshotRow = {
  cycle_id: string;
  progress: unknown;
  calculated_at: string;
};

export default async function RewardParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { ruleId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const { data: rule } = await ctx.supabase
    .from("reward_rules")
    .select("id,current_version_number,status")
    .eq("studio_id", ctx.studio.id)
    .eq("id", ruleId)
    .maybeSingle();

  if (!rule) notFound();

  const { data: version } = await ctx.supabase
    .from("reward_rule_versions")
    .select("name,human_summary")
    .eq("rule_id", rule.id)
    .eq("version_number", rule.current_version_number)
    .maybeSingle();

  const { data: participations } = await ctx.supabase
    .from("reward_participations")
    .select("id,student_id,status,joined_at,fulfilled_at,updated_at")
    .eq("rule_id", rule.id)
    .order("updated_at", { ascending: false });

  const studentIds = [...new Set((participations ?? []).map((item) => item.student_id))];
  const [{ data: students }, { data: cycles }, { data: incidents }] = await Promise.all([
    studentIds.length
      ? ctx.supabase.from("students").select("id,full_name,email").in("id", studentIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; full_name: string; email: string | null }>,
        }),
    studentIds.length
      ? ctx.supabase
          .from("reward_cycles")
          .select("id,student_id,status,window_end_at,updated_at")
          .eq("rule_id", rule.id)
          .in("student_id", studentIds)
          .order("updated_at", { ascending: false })
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            student_id: string;
            status: string;
            window_end_at: string | null;
            updated_at: string;
          }>,
        }),
    studentIds.length
      ? ctx.supabase
          .from("reward_incidents")
          .select("id,student_id,status,priority")
          .eq("rule_id", rule.id)
          .in("student_id", studentIds)
          .not("status", "eq", "closed")
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            student_id: string | null;
            status: string;
            priority: string;
          }>,
        }),
  ]);

  const cycleRows = (cycles ?? []) as RewardParticipantCycleRow[];
  const cycleIds = cycleRows.map((cycle) => cycle.id);
  const { data: snapshots } = cycleIds.length
    ? await ctx.supabase
        .from("reward_progress_snapshots")
        .select("cycle_id,progress,calculated_at")
        .in("cycle_id", cycleIds)
        .order("calculated_at", { ascending: false })
    : { data: [] as Array<{ cycle_id: string; progress: unknown; calculated_at: string }> };

  const snapshotRows = (snapshots ?? []) as RewardParticipantSnapshotRow[];
  const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
  const latestCycleByStudent = new Map<string, RewardParticipantCycleRow>();
  for (const cycle of cycleRows) {
    if (!latestCycleByStudent.has(cycle.student_id))
      latestCycleByStudent.set(cycle.student_id, cycle);
  }
  const latestSnapshotByCycle = new Map<string, RewardParticipantSnapshotRow>();
  for (const snapshot of snapshotRows) {
    if (!latestSnapshotByCycle.has(snapshot.cycle_id))
      latestSnapshotByCycle.set(snapshot.cycle_id, snapshot);
  }
  const incidentCountByStudent = new Map<string, number>();
  for (const incident of incidents ?? []) {
    if (!incident.student_id) continue;
    incidentCountByStudent.set(
      incident.student_id,
      (incidentCountByStudent.get(incident.student_id) ?? 0) + 1,
    );
  }

  const q = (query.q ?? "").trim().toLowerCase();
  const rows = (participations ?? []).filter((participation) => {
    const student = studentMap.get(participation.student_id);
    const matchesSearch =
      !q ||
      String(student?.full_name ?? "")
        .toLowerCase()
        .includes(q) ||
      String(student?.email ?? "")
        .toLowerCase()
        .includes(q);
    const matchesStatus = !query.status || participation.status === query.status;
    return matchesSearch && matchesStatus;
  });

  rows.sort((a, b) => {
    const aIncidents = incidentCountByStudent.get(a.student_id) ?? 0;
    const bIncidents = incidentCountByStudent.get(b.student_id) ?? 0;
    if (aIncidents !== bIncidents) return bIncidents - aIncidents;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link
          href={`/admin/recompensas/reglas/${rule.id}`}
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← {version?.name ?? "Regla"}
        </Link>
        <p className="eyebrow">PARTICIPANTES</p>
        <h1 className="dashboard-title">Progreso por alumna</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          {version?.human_summary ?? "Seguimiento de participación y progreso."}
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_auto_auto]">
        <input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Buscar alumna"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
        />
        <select
          name="status"
          defaultValue={query.status ?? ""}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
        >
          <option value="">Todos los estados</option>
          <option value="eligible">Elegible</option>
          <option value="in_progress">En progreso</option>
          <option value="fulfilled">Cumplida</option>
          <option value="closed">Cerrada</option>
        </select>
        <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white">
          Filtrar
        </button>
      </form>

      {!rows.length ? (
        <EmptyState title="No hay participantes con esos filtros">
          La participación aparece cuando el motor evalúa a una alumna elegible.
        </EmptyState>
      ) : (
        <section className="grid gap-3">
          {rows.map((participation) => {
            const student = studentMap.get(participation.student_id);
            const cycle = latestCycleByStudent.get(participation.student_id);
            const snapshot = cycle ? latestSnapshotByCycle.get(cycle.id) : null;
            const incidentCount = incidentCountByStudent.get(participation.student_id) ?? 0;

            return (
              <Link
                key={participation.id}
                href={`/admin/recompensas/reglas/${rule.id}/participantes/${participation.student_id}`}
                className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/35 lg:grid-cols-[1fr_1.2fr_auto]"
              >
                <div>
                  <strong className="text-base text-white">{student?.full_name ?? "Alumna"}</strong>
                  <p className="mt-1 text-xs text-zinc-500">{student?.email ?? "Sin correo"}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-300">
                    {snapshot
                      ? progressSummary(snapshot.progress)
                      : "Aún no hay snapshot de progreso."}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Último evento{" "}
                    {cycle
                      ? formatDateTime(cycle.updated_at)
                      : formatDateTime(participation.updated_at)}
                    {cycle?.window_end_at ? ` · cierra ${formatDateTime(cycle.window_end_at)}` : ""}
                  </p>
                </div>
                <div className="grid justify-items-start gap-2 lg:justify-items-end">
                  <StatusBadge status={cycle?.status ?? participation.status} />
                  {incidentCount ? (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
                      {incidentCount} incidencia{incidentCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
