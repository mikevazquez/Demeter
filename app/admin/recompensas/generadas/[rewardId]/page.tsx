import Link from "next/link";
import { notFound } from "next/navigation";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { adjustRewardAction } from "../../actions";
import { RewardsShell } from "../../RewardsNav";
import RewardAdjustedNotice from "../RewardAdjustedNotice";
import {
  StatusBadge,
  asArray,
  asObject,
  formatDateTime,
  metricLabels,
  rewardDefinitionLabel,
} from "../../ui";

function whyGenerated(value: unknown) {
  const rows = asArray(value).map(asObject);
  if (!rows.length) return "Generada por un cumplimiento validado por el sistema.";
  return rows
    .map((row) => {
      const metric = String(row.metric ?? "");
      const current = Number(row.current ?? 0);
      const target = Number(row.target ?? 0);
      return `${metricLabels[metric] ?? metric}: ${current}/${target}`;
    })
    .join(" · ");
}

export default async function GeneratedRewardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ rewardId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { rewardId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const { data: reward } = await ctx.supabase
    .from("reward_instances")
    .select(
      "id,student_id,rule_id,version_number,source_evaluation_id,status,kind,delivery_mode,benefit_definition,origin_snapshot,available_from,expires_at,reserved_at,reserved_until,redeemed_at,revoked_at,revoked_reason,created_at",
    )
    .eq("id", rewardId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (!reward) notFound();

  const [{ data: student }, evaluationResult, ruleVersionResult, eventsResult] = await Promise.all([
    ctx.supabase
      .from("students")
      .select("id,full_name,lifecycle_status")
      .eq("id", reward.student_id)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    reward.source_evaluation_id
      ? ctx.supabase
          .from("reward_progress_evaluations")
          .select("id,condition_results,progress,fulfilled,evaluated_at")
          .eq("id", reward.source_evaluation_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    reward.rule_id && reward.version_number
      ? ctx.supabase
          .from("reward_rule_versions")
          .select("rule_id,version_number,name,family,human_summary")
          .eq("rule_id", reward.rule_id)
          .eq("version_number", reward.version_number)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.supabase
      .from("reward_instance_events")
      .select("id,event_type,from_status,to_status,details,occurred_at")
      .eq("reward_instance_id", reward.id)
      .eq("studio_id", ctx.studio.id)
      .order("occurred_at", { ascending: false }),
  ]);

  const evaluation = evaluationResult.data;
  const ruleVersion = ruleVersionResult.data;
  const events = eventsResult.data ?? [];

  let originLabel = ruleVersion?.name ?? "Cumplimiento automático";
  let originType =
    ruleVersion?.family === "challenge"
      ? "Reto especial"
      : ruleVersion?.family === "achievement"
        ? "Logro"
        : "Motor de progreso";

  if (reward.rule_id && reward.version_number) {
    const { data: programLevel } = await ctx.supabase
      .from("reward_program_levels")
      .select("program_id,program_version_number,title")
      .eq("rule_id", reward.rule_id)
      .eq("rule_version_number", reward.version_number)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (programLevel) {
      const { data: programVersion } = await ctx.supabase
        .from("reward_program_versions")
        .select("name")
        .eq("program_id", programLevel.program_id)
        .eq("version_number", programLevel.program_version_number)
        .maybeSingle();
      originType = "Programa";
      originLabel = `${programVersion?.name ?? "Programa"} · ${programLevel.title}`;
    }
  }

  const canAdjust =
    ctx.can(CAPABILITIES.REWARDS_MANAGE) && ["blocked", "available"].includes(reward.status);

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/recompensas/generadas"
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Recompensas generadas
          </Link>
          <p className="mt-4 eyebrow">DETALLE DE RECOMPENSA</p>
          <h1 className="dashboard-title">{rewardDefinitionLabel(reward.benefit_definition, ctx.studio.locale, ctx.studio.currency)}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {student?.full_name ?? "Alumna"} · {originType}
          </p>
        </div>
        <StatusBadge status={reward.status} />
      </header>

      <RewardAdjustedNotice saved={query.saved} />
      {query.error ? <div className="notice error">{query.error}</div> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-700">
            BENEFICIO
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">
            {rewardDefinitionLabel(reward.benefit_definition, ctx.studio.locale, ctx.studio.currency)}
          </h2>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Obtenida</dt>
              <dd className="text-right text-slate-700">{formatDateTime(reward.created_at, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Vence</dt>
              <dd className="text-right text-slate-700">{formatDateTime(reward.expires_at, ctx.studio.locale, ctx.studio.timezone)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Entrega</dt>
              <dd className="text-right text-slate-700">
                {reward.delivery_mode === "auto_apply" ? "Aplicación automática" : "Canjeable"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-700">ORIGEN</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{originLabel}</h2>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {whyGenerated(evaluation?.condition_results)}
          </p>
          {evaluation ? (
            <p className="mt-3 text-xs text-slate-500">
              Validado {formatDateTime(evaluation.evaluated_at, ctx.studio.locale, ctx.studio.timezone)}
            </p>
          ) : null}
        </article>
      </section>

      {reward.status === "revoked" ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-300">
            AJUSTADA
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {reward.revoked_reason || "La recompensa fue ajustada mediante una excepción auditada."}
          </p>
        </section>
      ) : null}

      {canAdjust ? (
        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-rose-300">
            AJUSTE EXCEPCIONAL
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">Ajustar esta recompensa</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            No es una operación normal. El motivo es obligatorio y queda registrado en auditoría.
          </p>
          <form action={adjustRewardAction} className="mt-4 grid gap-3">
            <input type="hidden" name="reward_id" value={reward.id} />
            <label className="grid gap-1 text-sm text-slate-700">
              Motivo
              <textarea
                name="reason"
                rows={3}
                required
                maxLength={500}
                placeholder="Explica por qué debe ajustarse esta recompensa"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
              />
            </label>
            <div>
              <PendingActionButton
                className="rounded-xl border border-rose-500/25 px-4 py-2.5 text-sm font-semibold text-rose-300"
                pendingLabel="Ajustando…"
              >
                Confirmar ajuste
              </PendingActionButton>
            </div>
          </form>
        </section>
      ) : reward.status !== "revoked" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Esta recompensa ya está{" "}
          {reward.status === "reserved"
            ? "en uso"
            : reward.status === "redeemed"
              ? "utilizada"
              : "cerrada"}{" "}
          y no admite el ajuste directo disponible para recompensas abiertas.
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-700">
          HISTORIAL
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Movimientos de la recompensa</h2>
        <div className="mt-5 grid gap-2">
          {!events.length ? (
            <EmptyStateFallback />
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <strong className="text-sm text-slate-900">{event.event_type}</strong>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(event.occurred_at, ctx.studio.locale, ctx.studio.timezone)}</p>
                </div>
                <StatusBadge status={event.to_status} />
              </div>
            ))
          )}
        </div>
      </section>
    </RewardsShell>
  );
}

function EmptyStateFallback() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
      Todavía no hay movimientos adicionales.
    </div>
  );
}
