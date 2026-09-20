import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { formatRewardMoneyMinor, summarizeRewardMetrics } from "@/lib/rewards/metrics";

import {
  EmptyState,
  MetricCard,
  StatusBadge,
  familyLabels,
  formatDateTime,
  rewardDefinitionLabel,
} from "./ui";

export default async function RewardsHomePage() {
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const canManage = ctx.can(CAPABILITIES.REWARDS_MANAGE);

  const [
    rulesResult,
    participationsResult,
    rewardsResult,
    incidentsResult,
    lifecycleResult,
    rewardEventsResult,
    cyclesResult,
  ] = await Promise.all([
    ctx.supabase
      .from("reward_rules")
      .select("id,status,current_version_number,updated_at,scheduled_start_at,scheduled_end_at")
      .eq("studio_id", ctx.studio.id)
      .order("updated_at", { ascending: false }),
    ctx.supabase
      .from("reward_participations")
      .select("student_id,status")
      .eq("studio_id", ctx.studio.id)
      .in("status", ["eligible", "in_progress", "fulfilled"]),
    ctx.supabase
      .from("reward_instances")
      .select(
        "id,rule_id,status,kind,expires_at,benefit_definition,redemption_context,student_id,created_at",
      )
      .eq("studio_id", ctx.studio.id)
      .order("created_at", { ascending: false })
      .limit(200),
    ctx.supabase
      .from("reward_incidents")
      .select("id,status,priority,summary,opened_at")
      .eq("studio_id", ctx.studio.id)
      .not("status", "eq", "closed")
      .order("opened_at", { ascending: false })
      .limit(50),
    ctx.supabase
      .from("reward_rule_lifecycle")
      .select("id,rule_id,operation,to_status,created_at")
      .eq("studio_id", ctx.studio.id)
      .order("created_at", { ascending: false })
      .limit(8),
    ctx.supabase
      .from("reward_instance_events")
      .select("id,reward_instance_id,event_type,to_status,occurred_at")
      .eq("studio_id", ctx.studio.id)
      .order("occurred_at", { ascending: false })
      .limit(8),
    ctx.supabase
      .from("reward_cycles")
      .select("id,rule_id,student_id,status,window_end_at,updated_at")
      .eq("studio_id", ctx.studio.id)
      .in("status", ["open", "frozen"])
      .order("updated_at", { ascending: false })
      .limit(12),
  ]);

  const rules = rulesResult.data ?? [];
  const ruleIds = rules.map((rule) => rule.id);
  const { data: versions } = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family,human_summary,reward_definition")
        .in("rule_id", ruleIds)
    : { data: [] as Array<Record<string, unknown>> };

  const versionMap = new Map(
    (versions ?? []).map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );

  const activeRules = rules.filter((rule) => rule.status === "active");
  const participatingStudents = new Set(
    (participationsResult.data ?? []).map((item) => item.student_id),
  ).size;
  const availableRewards = (rewardsResult.data ?? []).filter(
    (reward) => reward.status === "available",
  );
  const rewardMetrics = summarizeRewardMetrics(rewardsResult.data ?? []);
  const openIncidents = incidentsResult.data ?? [];
  const expiringRewards = availableRewards
    .filter((reward) => reward.expires_at)
    .sort(
      (a, b) =>
        new Date(a.expires_at as string).getTime() - new Date(b.expires_at as string).getTime(),
    )
    .slice(0, 4);

  const activity = [
    ...(lifecycleResult.data ?? []).map((item) => ({
      id: `rule-${item.id}`,
      label: `Regla: ${item.operation}`,
      status: item.to_status,
      at: item.created_at,
    })),
    ...(rewardEventsResult.data ?? []).map((item) => ({
      id: `reward-${item.id}`,
      label: `Recompensa: ${item.event_type}`,
      status: item.to_status,
      at: item.occurred_at,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  return (
    <main className="dashboard-shell space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/admin/empresa"
            className="mb-3 inline-flex text-sm font-semibold text-zinc-400 transition hover:text-white"
          >
            ← Empresa
          </Link>
          <p className="eyebrow">RECOMPENSAS · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Recompensas</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Fidelidad, constancia, retos y logros en un solo motor. El progreso se deriva de eventos
            reales y nunca bloquea la operación del estudio.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/admin/recompensas/reglas/nueva"
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            + Crear regla
          </Link>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Reglas activas"
          value={activeRules.length}
          detail={`${rules.length} totales`}
        />
        <MetricCard
          label="Alumnas participando"
          value={participatingStudents}
          detail="participación elegible o activa"
        />
        <MetricCard
          label="Recompensas disponibles"
          value={availableRewards.length}
          detail="listas para utilizar"
        />
        <MetricCard
          label="Incidencias abiertas"
          value={openIncidents.length}
          detail={
            openIncidents.some((item) => item.priority === "critical")
              ? "hay prioridad crítica"
              : "sin bloqueos operativos"
          }
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Otorgadas"
          value={rewardMetrics.granted}
          detail={`${rewardMetrics.redeemed} utilizadas · ${rewardMetrics.expired} vencidas`}
        />
        <MetricCard
          label="Valor potencial"
          value={formatRewardMoneyMinor(rewardMetrics.potentialValueMinor)}
          detail={
            rewardMetrics.unvaluedPotentialCount
              ? `${rewardMetrics.unvaluedPotentialCount} beneficio(s) sin valor fijo no estimados`
              : "valor fijo conocido"
          }
        />
        <MetricCard
          label="Valor utilizado"
          value={formatRewardMoneyMinor(rewardMetrics.realizedValueMinor)}
          detail="solo ahorro real registrado al utilizar"
        />
        <MetricCard
          label="Créditos otorgados"
          value={rewardMetrics.creditsGranted}
          detail={`${rewardMetrics.creditsUsed} utilizados`}
        />
        <MetricCard label="Revocadas" value={rewardMetrics.revoked} detail="ajustes auditados" />
      </section>

      {openIncidents.length ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-300">
                REQUIERE ATENCIÓN
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {openIncidents.length} incidencia{openIncidents.length === 1 ? "" : "s"} abierta
                {openIncidents.length === 1 ? "" : "s"}
              </h2>
            </div>
            <Link
              href="/admin/recompensas/incidencias"
              className="text-sm font-semibold text-amber-200 hover:text-white"
            >
              Revisar incidencias →
            </Link>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
                REGLAS DESTACADAS
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Activas ahora</h2>
            </div>
            <Link
              href="/admin/recompensas/reglas"
              className="text-sm font-semibold text-zinc-400 hover:text-white"
            >
              Ver todas →
            </Link>
          </div>

          <div className="mt-5 grid gap-3">
            {!activeRules.length ? (
              <EmptyState title="Todavía no hay reglas activas">
                Crea una regla, revísala y actívala cuando esté lista.
              </EmptyState>
            ) : (
              activeRules.slice(0, 5).map((rule) => {
                const version = versionMap.get(`${rule.id}:${rule.current_version_number}`);
                return (
                  <Link
                    key={rule.id}
                    href={`/admin/recompensas/reglas/${rule.id}`}
                    className="rounded-2xl border border-white/10 bg-black/15 p-4 transition hover:border-fuchsia-500/35"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-fuchsia-300">
                          {familyLabels[String(version?.family ?? "")] ?? "Rewards"}
                        </p>
                        <h3 className="mt-1 font-semibold text-white">
                          {String(version?.name ?? "Regla")}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-400">
                          {String(version?.human_summary ?? "")}
                        </p>
                      </div>
                      <StatusBadge status={rule.status} />
                    </div>
                    <p className="mt-3 text-xs font-semibold text-zinc-500">
                      {rewardDefinitionLabel(version?.reward_definition)}
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
            PRÓXIMOS HITOS
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Progreso en curso</h2>
          <div className="mt-5 grid gap-3">
            {!(cyclesResult.data ?? []).length ? (
              <EmptyState title="Sin ciclos en curso" />
            ) : (
              (cyclesResult.data ?? []).slice(0, 6).map((cycle) => (
                <Link
                  key={cycle.id}
                  href={`/admin/recompensas/reglas/${cycle.rule_id}/participantes/${cycle.student_id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                >
                  <div>
                    <strong className="text-sm text-white">Ciclo en progreso</strong>
                    <p className="mt-1 text-xs text-zinc-500">
                      {cycle.window_end_at
                        ? `Cierra ${formatDateTime(cycle.window_end_at)}`
                        : "Sin cierre fijo"}
                    </p>
                  </div>
                  <StatusBadge status={cycle.status} />
                </Link>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
            ACTIVIDAD RECIENTE
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Últimos movimientos</h2>
          <div className="mt-5 grid gap-2">
            {!activity.length ? (
              <EmptyState title="Sin actividad todavía" />
            ) : (
              activity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                >
                  <div>
                    <strong className="text-sm text-white">{item.label}</strong>
                    <p className="mt-1 text-xs text-zinc-500">{formatDateTime(item.at)}</p>
                  </div>
                  <StatusBadge status={String(item.status)} />
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
            RECOMPENSAS
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Próximas a vencer</h2>
          <div className="mt-5 grid gap-2">
            {!expiringRewards.length ? (
              <EmptyState title="No hay recompensas próximas a vencer" />
            ) : (
              expiringRewards.map((reward) => (
                <div
                  key={reward.id}
                  className="rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">
                      {rewardDefinitionLabel(reward.benefit_definition)}
                    </strong>
                    <StatusBadge status={reward.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Vence {formatDateTime(reward.expires_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
