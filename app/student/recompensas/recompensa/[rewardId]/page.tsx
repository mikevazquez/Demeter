import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  getStudentRewardsContext,
  rewardAppliesTo,
  rewardBenefitLabel,
  rewardObject,
  rewardStackability,
  rewardStatusLabel,
} from "@/lib/student/rewards";

import { StateChip } from "../../components";

export default async function StudentRewardDetailPage({
  params,
}: {
  params: Promise<{ rewardId: string }>;
}) {
  const { rewardId } = await params;
  const ctx = await getStudentRewardsContext();
  const reward = ctx.rewards.find((item) => item.id === rewardId);

  if (!reward) notFound();

  const version =
    reward.rule_id && reward.version_number
      ? ctx.versionMap.get(`${reward.rule_id}:${reward.version_number}`)
      : undefined;
  const participation = reward.rule_id
    ? (ctx.participations.find((item) => item.rule_id === reward.rule_id) ?? null)
    : null;
  const cycle = reward.cycle_id
    ? (ctx.cycles.find((item) => item.id === reward.cycle_id) ?? null)
    : null;
  const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
  const conditions = version ? conditionProgress(version, snapshot) : [];
  const definition = rewardObject(reward.benefit_definition);
  const autoApplied = reward.delivery_mode === "auto_apply";
  const canUse = reward.status === "available" && !autoApplied;

  const originLabel = reward.manually_granted
    ? "Recompensa especial"
    : (version?.name ?? "Progreso y recompensas");

  const statusTone =
    reward.status === "available"
      ? "success"
      : reward.status === "reserved"
        ? "warning"
        : reward.status === "redeemed"
          ? "success"
          : reward.status === "revoked"
            ? "warning"
            : "neutral";

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas/mis-recompensas"
          className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
        >
          ← Mis recompensas
        </Link>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Detalle de recompensa
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {rewardBenefitLabel(reward)}
            </h1>
          </div>
          <StateChip tone={statusTone}>{rewardStatusLabel(reward.status)}</StateChip>
        </div>

        <p className="mt-2 text-sm text-zinc-400">
          {reward.status === "redeemed"
            ? autoApplied
              ? "Esta recompensa se aplicó automáticamente."
              : "Esta recompensa ya fue utilizada."
            : reward.status === "expired"
              ? "Esta recompensa venció y ya no puede utilizarse."
              : reward.status === "revoked"
                ? "Esta recompensa fue ajustada y permanece en tu historial."
                : reward.status === "reserved"
                  ? "Esta recompensa está reservada en una compra en curso."
                  : autoApplied
                    ? "Se aplicará automáticamente cuando corresponda."
                    : "Tu recompensa está lista para utilizarse en una compra elegible."}
        </p>
      </header>

      <section className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Aplicable a</p>
          <strong className="mt-1 block text-sm text-white">{rewardAppliesTo(definition)}</strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Compatibilidad</p>
          <strong className="mt-1 block text-sm text-white">
            {rewardStackability(definition)}
          </strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Disponible desde</p>
          <strong className="mt-1 block text-sm text-white">
            {reward.available_from
              ? formatDateTime(reward.available_from, ctx.studio.timezone)
              : "Desde que la desbloqueaste"}
          </strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Vigencia</p>
          <strong className="mt-1 block text-sm text-white">
            {reward.expires_at
              ? formatDateTime(reward.expires_at, ctx.studio.timezone)
              : "Sin vencimiento configurado"}
          </strong>
        </div>
      </section>

      <section className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Origen</p>
        <h2 className="mt-2 text-lg font-semibold text-white">{originLabel}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">
          {reward.manually_granted
            ? "Se agregó directamente a tu cuenta como un beneficio especial."
            : (version?.human_summary ?? "Cumpliste la condición asociada a esta recompensa.")}
        </p>

        {participation && !reward.manually_granted ? (
          <div className="mt-3">
            {ctx.programRuleIds.has(participation.rule_id) ? (
              (() => {
                const programParticipation = ctx.programParticipations.find((item) => {
                  const levels =
                    ctx.levelsByProgramVersion.get(
                      `${item.program_id}:${item.program_version_number}`,
                    ) ?? [];
                  return levels.some((level) => level.rule_id === participation.rule_id);
                });

                return programParticipation ? (
                  <Link
                    href={`/student/recompensas/programas/${programParticipation.id}`}
                    className="text-xs font-semibold text-fuchsia-300"
                  >
                    Ver el programa que la originó →
                  </Link>
                ) : null;
              })()
            ) : (
              <Link
                href={`/student/recompensas/retos/${participation.id}`}
                className="text-xs font-semibold text-fuchsia-300"
              >
                Ver el progreso que la originó →
              </Link>
            )}
          </div>
        ) : null}
      </section>

      {conditions.length ? (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Condición alcanzada
          </p>
          <div className="mt-2 space-y-2">
            {conditions.map((condition) => (
              <div
                key={condition.key}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <span className="text-sm text-zinc-300">{condition.label}</span>
                <strong className="text-sm text-white">
                  {String(condition.current ?? condition.target)} / {String(condition.target)}
                </strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {reward.kind === "fixed_discount" ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <strong className="text-sm text-white">Beneficio de uso único</strong>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Esta recompensa no se utiliza parcialmente. Si el beneficio supera el total elegible, el
            sobrante no se guarda como saldo.
          </p>
        </section>
      ) : null}

      {reward.status === "reserved" ? (
        <section className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.06] p-4">
          <strong className="text-sm text-amber-200">En uso</strong>
          <p className="mt-1 text-xs text-zinc-400">
            Está reservada en una compra en curso. Si esa compra se cancela, vuelve a Disponible.
          </p>
        </section>
      ) : null}

      {reward.status === "redeemed" ? (
        <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4">
          <strong className="text-sm text-emerald-200">
            {autoApplied ? "Aplicada automáticamente" : "Utilizada"}
          </strong>
          {reward.redeemed_at ? (
            <p className="mt-1 text-xs text-zinc-400">
              {formatDateTime(reward.redeemed_at, ctx.studio.timezone)}
            </p>
          ) : null}
        </section>
      ) : null}

      {canUse ? (
        <Link
          href="/student/paquete"
          className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          {reward.kind === "credits" ? "Usar recompensa" : "Ir a paquetes"}
        </Link>
      ) : null}
    </main>
  );
}
