import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, formatMoney } from "@/lib/student/portal";
import {
  actualRewardSavingsMinor,
  conditionProgress,
  getStudentRewardsContext,
  rewardAppliesTo,
  rewardBenefitLabel,
  rewardObject,
  rewardStackability,
} from "@/lib/student/rewards";

import { RewardStatus } from "../components";

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
      : null;
  const participation = reward.rule_id
    ? ctx.participations.find((item) => item.rule_id === reward.rule_id)
    : null;

  const definition = rewardObject(reward.benefit_definition);
  const conditions =
    version && participation
      ? conditionProgress(
          version,
          reward.cycle_id
            ? (ctx.latestSnapshotByCycle.get(reward.cycle_id) ?? null)
            : null,
        )
      : [];
  const actualSavings = actualRewardSavingsMinor(reward);
  const autoApplied = reward.delivery_mode === "auto_apply";
  const canUse = reward.status === "available" && !autoApplied;
  const reserved = reward.status === "reserved";
  const fixedDiscount = reward.kind === "fixed_discount";
  const availableInFuture =
    reward.available_from && Date.parse(reward.available_from) > Date.now();

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="mb-3 inline-flex text-xs font-semibold text-zinc-400 hover:text-white"
        >
          ← Mis recompensas
        </Link>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          DETALLE DE RECOMPENSA
        </p>
      </header>

      <section className="rounded-3xl border border-fuchsia-500/25 bg-[radial-gradient(circle_at_85%_15%,rgba(236,72,153,0.2),transparent_30%),linear-gradient(135deg,rgba(236,72,153,0.09),rgba(255,255,255,0.02))] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
              Tu beneficio
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {rewardBenefitLabel(reward)}
            </h1>
          </div>
          <RewardStatus status={reward.status} />
        </div>

        <p className="mt-4 text-sm text-zinc-400">
          {reward.status === "redeemed"
            ? "Esta recompensa ya fue utilizada."
            : reward.status === "expired"
              ? "Esta recompensa venció y ya no puede utilizarse."
              : reward.status === "revoked"
                ? "Esta recompensa fue ajustada por el estudio y permanece en tu historial."
                : reserved
                  ? "Esta recompensa está reservada en una compra en curso."
                  : autoApplied
                    ? "Este beneficio se aplica automáticamente cuando corresponde."
                    : availableInFuture
                      ? "Tu beneficio estará disponible a partir de la fecha indicada."
                      : "Tu recompensa está lista para utilizarse en una compra elegible."}
        </p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              APLICA EN
            </p>
            <strong className="mt-1 block text-sm text-white">
              {rewardAppliesTo(definition)}
            </strong>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              COMBINACIÓN
            </p>
            <strong className="mt-1 block text-sm text-white">
              {rewardStackability(definition)}
            </strong>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              DISPONIBLE DESDE
            </p>
            <strong className="mt-1 block text-sm text-white">
              {reward.available_from
                ? formatDateTime(reward.available_from, ctx.studio.timezone)
                : "Al desbloquearse"}
            </strong>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              VIGENCIA
            </p>
            <strong className="mt-1 block text-sm text-white">
              {reward.expires_at
                ? formatDateTime(reward.expires_at, ctx.studio.timezone)
                : "Sin vencimiento definido"}
            </strong>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
          POR QUÉ LA GANASTE
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          {reward.manually_granted ? "Beneficio otorgado por el estudio" : version?.name ?? "Rewards"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {reward.manually_granted
            ? "Se agregó directamente a tu cuenta como una recompensa especial."
            : version?.human_summary ?? "Cumpliste la condición asociada a esta recompensa."}
        </p>
        {participation && !reward.manually_granted ? (
          <Link
            href={`/student/recompensas/progreso/${participation.id}`}
            className="mt-4 inline-flex text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200"
          >
            Ver el progreso que la originó →
          </Link>
        ) : null}
      </section>

      {conditions.length ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            CONDICIONES
          </p>
          <div className="mt-4 grid gap-2">
            {conditions.map((condition) => (
              <div
                key={condition.key}
                className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-4"
              >
                <span className="text-sm text-zinc-300">{condition.label}</span>
                <span className="text-xs font-semibold text-emerald-300">Cumplida</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {fixedDiscount ? (
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
          <strong className="text-sm text-amber-200">Uso completo</strong>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Esta recompensa no se utiliza parcialmente. Si el beneficio es mayor que el total
            elegible de la compra, el sobrante no se guarda como saldo.
          </p>
        </section>
      ) : null}

      {reward.status === "redeemed" ? (
        <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
            UTILIZADA
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            {reward.redeemed_at
              ? formatDateTime(reward.redeemed_at, ctx.studio.timezone)
              : "Uso registrado"}
          </p>
          {actualSavings !== null ? (
            <strong className="mt-2 block text-xl text-white">
              Ahorro real: {formatMoney(actualSavings)}
            </strong>
          ) : null}
        </section>
      ) : null}

      {canUse ? (
        <Link
          href="/student/paquete"
          className="flex min-h-12 items-center justify-center rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          Usar recompensa
        </Link>
      ) : reserved ? (
        <Link
          href="/student/paquete"
          className="flex min-h-12 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] px-5 py-3 text-sm font-semibold text-amber-200"
        >
          Volver a la compra
        </Link>
      ) : null}
    </main>
  );
}
