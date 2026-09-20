import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  exactMissingLabel,
  familyLabel,
  getStudentRewardsContext,
  isNearComplete,
  isStudentRewardProgressActive,
  rewardObject,
  singleNumericProgress,
} from "@/lib/student/rewards";

import { RewardCard, RewardsEmpty } from "./components";

export default async function StudentRewardsPage() {
  const ctx = await getStudentRewardsContext();
  const availableRewards = ctx.rewards
    .filter((reward) => reward.status === "available")
    .sort((left, right) => {
      const leftExpiry = left.expires_at ? Date.parse(left.expires_at) : Number.POSITIVE_INFINITY;
      const rightExpiry = right.expires_at
        ? Date.parse(right.expires_at)
        : Number.POSITIVE_INFINITY;
      return leftExpiry - rightExpiry;
    });

  const progressItems = ctx.participations
    .map((participation) => {
      const version = ctx.versionMap.get(
        `${participation.rule_id}:${participation.joined_version_number}`,
      );
      const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
      const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
      const rule = ctx.ruleMap.get(participation.rule_id) ?? null;
      const presentation = rewardObject(version?.presentation_definition);

      return {
        participation,
        rule,
        version,
        cycle,
        snapshot,
        visible:
          Boolean(version) &&
          presentation.progress_visible !== false &&
          presentation.hidden_until_unlocked !== true,
        conditions: version ? conditionProgress(version, snapshot) : [],
      };
    })
    .filter(
      (item) =>
        item.version &&
        item.visible &&
        isStudentRewardProgressActive(item.participation, item.rule, item.cycle),
    );

  const nearComplete = progressItems.filter((item) => isNearComplete(item.conditions));
  const nearCompleteIds = new Set(nearComplete.map((item) => item.participation.id));

  const timedChallenges = progressItems
    .filter(
      (item) =>
        item.version?.family === "challenge" &&
        item.cycle?.window_end_at &&
        !nearCompleteIds.has(item.participation.id),
    )
    .sort(
      (left, right) =>
        Date.parse(left.cycle?.window_end_at ?? "") - Date.parse(right.cycle?.window_end_at ?? ""),
    );

  const challengeIds = new Set(timedChallenges.map((item) => item.participation.id));
  const loyalty = progressItems.filter(
    (item) =>
      item.version?.family === "loyalty" &&
      !nearCompleteIds.has(item.participation.id) &&
      !challengeIds.has(item.participation.id),
  );
  const loyaltyIds = new Set(loyalty.map((item) => item.participation.id));

  const otherProgress = progressItems.filter(
    (item) =>
      !nearCompleteIds.has(item.participation.id) &&
      !challengeIds.has(item.participation.id) &&
      !loyaltyIds.has(item.participation.id),
  );

  const recentAchievements = ctx.achievements.slice(0, 3);
  const historicalCount = ctx.rewards.filter((reward) =>
    ["redeemed", "expired", "revoked"].includes(reward.status),
  ).length;

  const hasAnyContent =
    availableRewards.length || progressItems.length || recentAchievements.length || historicalCount;

  return (
    <main className="space-y-5 pb-4">
      <header className="rounded-3xl border border-fuchsia-500/15 bg-[radial-gradient(circle_at_85%_15%,rgba(236,72,153,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Rewards
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mis recompensas
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Aquí aparecen primero los beneficios que puedes usar, después lo que estás más cerca de
          completar y tus retos activos.
        </p>
      </header>

      {!hasAnyContent ? (
        <RewardsEmpty
          title="Todavía no tienes recompensas"
          detail="Cuando avances en fidelidad, constancia, retos o logros, tu progreso aparecerá aquí."
          actionHref="/student/reservar"
          actionLabel="Reservar una clase"
        />
      ) : null}

      {availableRewards.length ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                LISTAS PARA USAR
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Tus recompensas</h2>
            </div>
            {historicalCount ? (
              <Link
                href="/student/recompensas/historial"
                className="text-xs font-semibold text-zinc-400 hover:text-white"
              >
                Ver historial
              </Link>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {availableRewards.map((reward) => (
              <RewardCard key={reward.id} reward={reward} timezone={ctx.studio.timezone} />
            ))}
          </div>
        </section>
      ) : null}

      {nearComplete.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              CASI LO LOGRAS
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Estás muy cerca</h2>
          </div>
          <div className="grid gap-3">
            {nearComplete.map((item) => {
              const numeric = singleNumericProgress(item.conditions);
              return (
                <Link
                  key={item.participation.id}
                  href={`/student/recompensas/progreso/${item.participation.id}`}
                  className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-5 transition hover:border-fuchsia-400/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                        {familyLabel(item.version?.family ?? "")}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-white">
                        {item.version?.name}
                      </h3>
                    </div>
                    <span className="text-lg text-zinc-500">›</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">
                    {exactMissingLabel(item.conditions)}
                  </p>
                  {numeric ? (
                    <div className="mt-4">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-fuchsia-500"
                          style={{ width: `${numeric.percent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        {numeric.current} de {numeric.target}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      {item.conditions.filter((condition) => condition.completed).length} de{" "}
                      {item.conditions.length} condiciones completas
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {timedChallenges.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              RETOS CON FECHA
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Activos ahora</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {timedChallenges.map((item) => (
              <Link
                key={item.participation.id}
                href={`/student/recompensas/progreso/${item.participation.id}`}
                className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.05] p-5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  Reto
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">{item.version?.name}</h3>
                <p className="mt-2 text-sm text-zinc-400">{exactMissingLabel(item.conditions)}</p>
                <p className="mt-3 text-xs font-medium text-amber-200">
                  Termina {formatDateTime(item.cycle?.window_end_at ?? "", ctx.studio.timezone)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {otherProgress.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              EN PROGRESO
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Sigue avanzando</h2>
          </div>
          <div className="grid gap-2">
            {otherProgress.map((item) => (
              <Link
                key={item.participation.id}
                href={`/student/recompensas/progreso/${item.participation.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                    {familyLabel(item.version?.family ?? "")}
                  </p>
                  <strong className="mt-1 block text-sm text-white">{item.version?.name}</strong>
                  <p className="mt-1 text-xs text-zinc-500">{exactMissingLabel(item.conditions)}</p>
                </div>
                <span className="text-lg text-zinc-500">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {loyalty.length ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            FIDELIDAD
          </p>
          <div className="mt-3 grid gap-2">
            {loyalty.map((item) => (
              <Link
                key={item.participation.id}
                href={`/student/recompensas/progreso/${item.participation.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-4"
              >
                <div>
                  <strong className="text-sm text-white">{item.version?.name}</strong>
                  <p className="mt-1 text-xs text-zinc-500">{exactMissingLabel(item.conditions)}</p>
                </div>
                <span className="text-lg text-zinc-500">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recentAchievements.length ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                LOGROS RECIENTES
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Tu trayectoria</h2>
            </div>
            <Link
              href="/student/recompensas/logros"
              className="text-xs font-semibold text-zinc-400 hover:text-white"
            >
              Ver todos
            </Link>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {recentAchievements.map((achievement) => (
              <Link
                key={achievement.id}
                href="/student/recompensas/logros"
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <span aria-hidden="true" className="text-2xl text-fuchsia-300">
                  ◇
                </span>
                <strong className="mt-2 block text-sm text-white">
                  {achievement.title_snapshot}
                </strong>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {formatDateTime(achievement.unlocked_at, ctx.studio.timezone)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {historicalCount ? (
        <Link
          href="/student/recompensas/historial"
          className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[0.03] p-5"
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              HISTORIAL
            </p>
            <strong className="mt-1 block text-base text-white">
              Recompensas utilizadas y anteriores
            </strong>
          </div>
          <span className="text-xl text-zinc-500">›</span>
        </Link>
      ) : null}
    </main>
  );
}
