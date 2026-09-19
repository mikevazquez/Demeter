import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { duplicateRewardRuleAction, transitionRewardRuleAction } from "../../actions";
import {
  EmptyState,
  MetricCard,
  StatusBadge,
  asObject,
  familyLabels,
  formatDateTime,
  primaryConditionSummary,
  rewardDefinitionLabel,
  rewardStatusLabels,
} from "../../ui";

export default async function RewardRuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; version?: string }>;
}) {
  const { ruleId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const canManage = ctx.can(CAPABILITIES.REWARDS_MANAGE);

  const { data: rule } = await ctx.supabase
    .from("reward_rules")
    .select("*")
    .eq("studio_id", ctx.studio.id)
    .eq("id", ruleId)
    .maybeSingle();

  if (!rule) notFound();

  const [
    currentVersionResult,
    versionsResult,
    participationsResult,
    cyclesResult,
    rewardsResult,
    incidentsResult,
    lifecycleResult,
  ] = await Promise.all([
    ctx.supabase
      .from("reward_rule_versions")
      .select("*")
      .eq("rule_id", rule.id)
      .eq("version_number", rule.current_version_number)
      .maybeSingle(),
    ctx.supabase
      .from("reward_rule_versions")
      .select("version_number,name,human_summary,created_at")
      .eq("rule_id", rule.id)
      .order("version_number", { ascending: false }),
    ctx.supabase
      .from("reward_participations")
      .select("id,student_id,status,fulfilled_at,updated_at")
      .eq("rule_id", rule.id),
    ctx.supabase
      .from("reward_cycles")
      .select("id,status,student_id,fulfilled_at,window_end_at")
      .eq("rule_id", rule.id),
    ctx.supabase
      .from("reward_instances")
      .select("id,status,kind,benefit_definition,redeemed_at")
      .eq("rule_id", rule.id),
    ctx.supabase
      .from("reward_incidents")
      .select("id,status,priority,summary,opened_at")
      .eq("rule_id", rule.id)
      .order("opened_at", { ascending: false })
      .limit(5),
    ctx.supabase
      .from("reward_rule_lifecycle")
      .select("id,operation,from_status,to_status,version_number,note,created_at")
      .eq("rule_id", rule.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const version = currentVersionResult.data;
  if (!version) notFound();

  const participations = participationsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const rewards = rewardsResult.data ?? [];
  const incidents = incidentsResult.data ?? [];
  const rewardStates = new Map<string, number>();
  for (const reward of rewards) {
    rewardStates.set(reward.status, (rewardStates.get(reward.status) ?? 0) + 1);
  }

  const audience = asObject(version.audience_definition);
  const evaluation = asObject(version.evaluation_definition);
  const cycleDefinition = asObject(version.cycle_definition);
  const presentation = asObject(version.presentation_definition);

  return (
    <main className="dashboard-shell space-y-6">
      <header>
        <Link
          href="/admin/recompensas/reglas"
          className="mb-3 inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Reglas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow !mb-0">
                {familyLabels[version.family] ?? version.family} · V{rule.current_version_number}
              </p>
              <StatusBadge status={rule.status} />
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white">
              {version.name}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              {version.human_summary}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canManage && !["finished", "cancelled"].includes(rule.status) ? (
              <Link
                href={`/admin/recompensas/reglas/${rule.id}/editar`}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Editar / nueva versión
              </Link>
            ) : null}
            <Link
              href={`/admin/recompensas/reglas/${rule.id}/participantes`}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Participantes
            </Link>
          </div>
        </div>
      </header>

      {query.saved ? (
        <div className="notice success">
          Cambio guardado correctamente{query.version ? ` · versión ${query.version}` : ""}.
        </div>
      ) : null}
      {query.error ? (
        <div className="notice error">No se pudo completar la acción: {query.error}</div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Participantes" value={participations.length} />
        <MetricCard
          label="Cumplieron"
          value={cycles.filter((cycle) => cycle.status === "fulfilled").length}
        />
        <MetricCard label="Disponibles" value={rewardStates.get("available") ?? 0} />
        <MetricCard label="Utilizadas" value={rewardStates.get("redeemed") ?? 0} />
        <MetricCard
          label="Incidencias"
          value={incidents.filter((item) => item.status !== "closed").length}
        />
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            ACCIONES
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {rule.status === "draft" && rule.scheduled_start_at ? (
              <form action={transitionRewardRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="action" value="schedule" />
                <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white">
                  Programar
                </button>
              </form>
            ) : null}
            {["draft", "scheduled", "paused"].includes(rule.status) ? (
              <form action={transitionRewardRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="action" value="activate" />
                <button className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white">
                  {rule.status === "paused" ? "Reactivar" : "Activar"}
                </button>
              </form>
            ) : null}
            {rule.status === "active" ? (
              <form action={transitionRewardRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="action" value="pause" />
                <button className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200">
                  Pausar
                </button>
              </form>
            ) : null}
            {["active", "paused", "scheduled"].includes(rule.status) ? (
              <form action={transitionRewardRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="action" value="finish" />
                <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white">
                  Finalizar
                </button>
              </form>
            ) : null}
            {!["finished", "cancelled"].includes(rule.status) ? (
              <form action={transitionRewardRuleAction}>
                <input type="hidden" name="rule_id" value={rule.id} />
                <input type="hidden" name="action" value="cancel" />
                <button className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-200">
                  Cancelar
                </button>
              </form>
            ) : null}
            <form action={duplicateRewardRuleAction}>
              <input type="hidden" name="rule_id" value={rule.id} />
              <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white">
                Duplicar
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            CONFIGURACIÓN
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Cómo funciona</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              ["Audiencia", String(audience.scope ?? "Alumnas activas")],
              ["Condición", primaryConditionSummary(version.condition_definition)],
              ["Recompensa", rewardDefinitionLabel(version.reward_definition)],
              ["Ciclo", String(cycleDefinition.cadence ?? "continuous")],
              ["Histórico", evaluation.allow_historical ? "Permitido" : "Desde activación"],
              ["Progreso visible", presentation.progress_visible === false ? "No" : "Sí"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-black/15 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{label}</p>
                <strong className="mt-2 block text-sm text-white">{value}</strong>
              </div>
            ))}
          </div>
          {version.description ? (
            <p className="mt-5 text-sm leading-6 text-zinc-400">{version.description}</p>
          ) : null}
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            TIEMPOS
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span className="text-zinc-500">Inicio programado</span>
              <strong className="text-right text-white">
                {formatDateTime(rule.scheduled_start_at)}
              </strong>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span className="text-zinc-500">Fin programado</span>
              <strong className="text-right text-white">
                {formatDateTime(rule.scheduled_end_at)}
              </strong>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span className="text-zinc-500">Primera activación</span>
              <strong className="text-right text-white">
                {formatDateTime(rule.first_activated_at)}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Última actualización</span>
              <strong className="text-right text-white">{formatDateTime(rule.updated_at)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
                FUNNEL
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Participación</h2>
            </div>
            <Link
              href={`/admin/recompensas/reglas/${rule.id}/participantes`}
              className="text-sm font-semibold text-zinc-400 hover:text-white"
            >
              Abrir →
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetricCard
              label="Elegibles / en curso"
              value={participations.filter((item) => item.status !== "closed").length}
            />
            <MetricCard
              label="Cumplidas"
              value={participations.filter((item) => item.status === "fulfilled").length}
            />
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            RECOMPENSAS
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Estados generados</h2>
          <div className="mt-5 grid gap-2">
            {!rewards.length ? (
              <EmptyState title="Todavía no se han generado recompensas" />
            ) : (
              [...rewardStates.entries()].map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                >
                  <span className="text-sm text-zinc-300">
                    {rewardStatusLabels[status] ?? status}
                  </span>
                  <strong className="text-white">{count}</strong>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            VERSIONES
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Historial de configuración</h2>
          <div className="mt-5 grid gap-2">
            {(versionsResult.data ?? []).map((item) => (
              <div
                key={item.version_number}
                className="rounded-xl border border-white/10 bg-black/15 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-white">Versión {item.version_number}</strong>
                  <span className="text-xs text-zinc-500">{formatDateTime(item.created_at)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{item.human_summary}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            ACTIVIDAD
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Cambios de estado</h2>
          <div className="mt-5 grid gap-2">
            {!(lifecycleResult.data ?? []).length ? (
              <EmptyState title="Sin cambios de estado" />
            ) : (
              (lifecycleResult.data ?? []).map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">{item.operation}</strong>
                    <span className="text-xs text-zinc-500">{formatDateTime(item.created_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    V{item.version_number} · {item.from_status ?? "inicio"} → {item.to_status}
                    {item.note ? ` · ${item.note}` : ""}
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
