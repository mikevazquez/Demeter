import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  getStudentRewardsContext,
  rewardAppliesTo,
  rewardBenefitLabel,
  rewardObject,
  rewardStackability,
  rewardStatusLabel,
} from "@/lib/student/rewards";

import { RewardsEmpty, StateChip } from "../components";

const historyFilters = [
  { key: "all", label: "Todas" },
  { key: "used", label: "Utilizadas" },
  { key: "expired", label: "Vencidas" },
  { key: "adjusted", label: "Ajustadas" },
] as const;

function rewardOriginLabel(ctx: Awaited<ReturnType<typeof getStudentRewardsContext>>, ruleId: string | null) {
  if (!ruleId) return "Recompensa especial";
  const participation = ctx.participations.find((item) => item.rule_id === ruleId);
  if (!participation) return "Recompensa";
  const version = ctx.versionMap.get(`${participation.rule_id}:${participation.joined_version_number}`);
  if (!version) return "Recompensa";
  if (ctx.programRuleIds.has(ruleId)) return "Programa";
  const presentation = rewardObject(version.presentation_definition);
  if (presentation.challenge_mode) return "Reto especial";
  if (version.family === "achievement") return "Logro";
  return version.name;
}

export default async function StudentRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getStudentRewardsContext();
  const activeView = historyFilters.some((item) => item.key === query.view) ? query.view! : "all";

  const usable = ctx.rewards.filter((reward) => ["available", "reserved"].includes(reward.status));
  const history = ctx.rewards
    .filter((reward) => ["redeemed", "expired", "revoked"].includes(reward.status))
    .filter((reward) => {
      if (activeView === "used") return reward.status === "redeemed";
      if (activeView === "expired") return reward.status === "expired";
      if (activeView === "adjusted") return reward.status === "revoked";
      return true;
    });

  function historyHref(view: string) {
    return view === "all"
      ? "/student/recompensas/mis-recompensas"
      : `/student/recompensas/mis-recompensas?view=${view}`;
  }

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
        >
          ← Mi progreso
        </Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          Beneficios
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mis recompensas
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Tus beneficios disponibles y el historial de los que ya utilizaste.
        </p>
      </header>

      {usable.length ? (
        <section>
          <div className="mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Utilizables ahora
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-white">
              Recompensas disponibles
            </h2>
          </div>

          <div className="space-y-2">
            {usable.map((reward) => {
              const autoApplied = reward.delivery_mode === "auto_apply";
              const reserved = reward.status === "reserved";

              return (
                <div
                  key={reward.id}
                  className="rounded-3xl border border-fuchsia-500/20 bg-[radial-gradient(circle_at_90%_10%,rgba(236,72,153,0.14),transparent_35%),rgba(255,255,255,0.03)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {rewardOriginLabel(ctx, reward.rule_id)}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-white">
                        {rewardBenefitLabel(reward)}
                      </h3>
                    </div>
                    <StateChip tone={reserved ? "warning" : "success"}>
                      {rewardStatusLabel(reward.status)}
                    </StateChip>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5">
                      <span className="block text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                        Aplicable a
                      </span>
                      <strong className="mt-1 block font-medium text-zinc-200">
                        {rewardAppliesTo(reward.benefit_definition)}
                      </strong>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5">
                      <span className="block text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                        Compatibilidad
                      </span>
                      <strong className="mt-1 block font-medium text-zinc-200">
                        {rewardStackability(reward.benefit_definition)}
                      </strong>
                    </div>
                  </div>

                  {reward.expires_at ? (
                    <p className="mt-3 text-xs text-zinc-500">
                      Vence {formatDateTime(reward.expires_at, ctx.studio.timezone)}
                    </p>
                  ) : null}

                  {autoApplied ? (
                    <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-2.5">
                      <strong className="text-xs text-emerald-200">Aplicación automática</strong>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Studio Flow la aplica cuando corresponde; no necesitas seleccionarla.
                      </p>
                    </div>
                  ) : reserved ? (
                    <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2.5">
                      <strong className="text-xs text-amber-200">En uso</strong>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Está reservada en una compra en curso. Si la compra se cancela, vuelve a Disponible.
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    <Link
                      href={`/student/recompensas/recompensa/${reward.id}`}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      Ver detalle
                    </Link>
                    {!autoApplied && !reserved ? (
                      <Link
                        href="/student/paquete"
                        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
                      >
                        {reward.kind === "credits" ? "Usar recompensa" : "Ir a paquetes"}
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <RewardsEmpty
          title="No tienes recompensas disponibles"
          detail="Cuando desbloquees un beneficio utilizable, aparecerá aquí."
          actionHref="/student/recompensas"
          actionLabel="Volver a Mi progreso"
        />
      )}

      <section>
        <div className="mb-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Historial
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-white">Recompensas anteriores</h2>
        </div>

        <div className="mb-3 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {historyFilters.map((item) => (
              <Link
                key={item.key}
                href={historyHref(item.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeView === item.key ? "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {history.length ? (
          <div className="space-y-2">
            {history.map((reward) => {
              const autoApplied = reward.delivery_mode === "auto_apply" && reward.status === "redeemed";
              const occurredAt =
                reward.status === "redeemed"
                  ? reward.redeemed_at
                  : reward.status === "revoked"
                    ? reward.revoked_at
                    : reward.expires_at ?? reward.created_at;

              return (
                <Link
                  key={reward.id}
                  href={`/student/recompensas/recompensa/${reward.id}`}
                  className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 transition hover:border-fuchsia-500/20"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm text-white">
                      {rewardBenefitLabel(reward)}
                    </strong>
                    <span className="mt-1 block text-[11px] text-zinc-500">
                      {autoApplied ? "Aplicada automáticamente" : rewardOriginLabel(ctx, reward.rule_id)}
                      {occurredAt
                        ? ` · ${formatDateTime(occurredAt, ctx.studio.timezone)}`
                        : ""}
                    </span>
                  </div>
                  <StateChip
                    tone={
                      reward.status === "redeemed"
                        ? "success"
                        : reward.status === "expired"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {rewardStatusLabel(reward.status)}
                  </StateChip>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-sm font-semibold text-white">No hay recompensas en esta vista</p>
            <p className="mt-1 text-xs text-zinc-500">
              Cuando alguna recompensa cambie a un estado histórico aparecerá aquí.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
