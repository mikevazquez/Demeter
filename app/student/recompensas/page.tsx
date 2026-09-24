import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  getStudentRewardsContext,
  isChallengeVersion,
  rewardBenefitLabel,
  rewardDefinitionLabel,
  rewardObject,
} from "@/lib/student/rewards";
import {
  conditionCompletionPercent,
  exactMissingLabel,
  isStudentRewardProgressActive,
} from "@/lib/student/reward-progress-ui";

import { ProgressBar, RewardsEmpty, SectionHeading, StateChip, SummaryTile } from "./components";
import { MedalsAccessUnlocked, RewardsOnboardingActivation } from "./OnboardingActivation";

function rewardLabelFromDefinition(value: unknown) {
  const definition = rewardObject(value);
  const rewards = Array.isArray(definition.rewards) ? definition.rewards : null;

  if (rewards && rewards.length === 0) return null;
  if (!rewards && Object.keys(definition).length === 0) return null;
  return rewardDefinitionLabel(value);
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}

export default async function StudentProgressPage() {
  const ctx = await getStudentRewardsContext();

  if (ctx.onboarding && !ctx.onboarding.access_unlocked_at) {
    const upcomingClass =
      [...ctx.snapshot.upcoming].sort(
        (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
      )[0] ?? null;

    return (
      <RewardsOnboardingActivation
        onboarding={ctx.onboarding}
        upcomingClass={upcomingClass}
        timeZone={ctx.studio.timezone}
        studioId={ctx.membership.studio_id}
        studioName={ctx.studio.name}
      />
    );
  }

  if (
    ctx.onboarding?.access_unlocked_at &&
    !ctx.onboarding.access_acknowledged_at &&
    ctx.onboarding.access_method !== "legacy"
  ) {
    return <MedalsAccessUnlocked />;
  }

  const activePrograms = ctx.programParticipations
    .filter((participation) => {
      const program = ctx.programMap.get(participation.program_id);
      return (
        participation.status === "active" &&
        Boolean(program) &&
        ["active", "paused"].includes(program?.status ?? "")
      );
    })
    .map((participation) => {
      const program = ctx.programMap.get(participation.program_id)!;
      const version = ctx.programVersionMap.get(
        `${participation.program_id}:${participation.program_version_number}`,
      );
      const levels =
        ctx.levelsByProgramVersion.get(
          `${participation.program_id}:${participation.program_version_number}`,
        ) ?? [];
      const currentOrder = participation.current_level_order ?? levels[0]?.level_order ?? null;
      const level = levels.find((item) => item.level_order === currentOrder) ?? null;
      const ruleParticipation = level ? ctx.ruleParticipationByRule.get(level.rule_id) : null;
      const cycle = ruleParticipation
        ? (ctx.latestCycleByParticipation.get(ruleParticipation.id) ?? null)
        : null;
      const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
      const ruleVersion = level
        ? ctx.versionMap.get(`${level.rule_id}:${level.rule_version_number}`)
        : undefined;
      const conditions = ruleVersion ? conditionProgress(ruleVersion, snapshot) : [];
      const percent = conditionCompletionPercent(conditions);
      const unlocked = new Set(
        ctx.programUnlocks
          .filter((item) => item.participation_id === participation.id)
          .map((item) => item.level_id),
      );

      return {
        participation,
        program,
        version,
        levels,
        level,
        ruleParticipation,
        cycle,
        ruleVersion,
        conditions,
        percent,
        unlocked,
      };
    });

  const activeChallenges = ctx.participations
    .map((participation) => {
      const rule = ctx.ruleMap.get(participation.rule_id);
      const version = ctx.versionMap.get(
        `${participation.rule_id}:${participation.joined_version_number}`,
      );
      const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
      const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
      const conditions = version ? conditionProgress(version, snapshot) : [];

      return {
        participation,
        rule,
        version,
        cycle,
        conditions,
        percent: conditionCompletionPercent(conditions),
      };
    })
    .filter(
      (item) =>
        !ctx.programRuleIds.has(item.participation.rule_id) &&
        isChallengeVersion(item.version) &&
        isStudentRewardProgressActive(item.participation, item.rule, item.cycle),
    );

  const nearestCandidates = [
    ...activePrograms
      .filter((item) => item.level && item.level.level_visibility === "visible")
      .map((item) => ({
        kind: "program" as const,
        href: `/student/recompensas/programas/${item.participation.id}`,
        eyebrow: item.version?.name ?? "Programa",
        title: item.level?.title ?? "Objetivo actual",
        percent: item.percent,
        missing: exactMissingLabel(item.conditions),
        deadline: item.cycle?.window_end_at ?? null,
        reward: item.ruleVersion
          ? rewardLabelFromDefinition(item.ruleVersion.reward_definition)
          : null,
      })),
    ...activeChallenges.map((item) => ({
      kind: "challenge" as const,
      href: `/student/recompensas/retos/${item.participation.id}`,
      eyebrow: "Reto especial",
      title: item.version?.name ?? "Reto activo",
      percent: item.percent,
      missing: exactMissingLabel(item.conditions),
      deadline: item.cycle?.window_end_at ?? item.rule?.scheduled_end_at ?? null,
      reward: item.version ? rewardLabelFromDefinition(item.version.reward_definition) : null,
    })),
  ]
    .filter((item) => item.percent < 100)
    .sort((left, right) => right.percent - left.percent);

  const nearest = nearestCandidates[0] ?? null;
  const availableRewards = ctx.rewards.filter((reward) => reward.status === "available");
  const recentAchievements = ctx.achievements.slice(0, 4);

  let currentStreak = 0;
  let bestStreak = 0;
  for (const snapshot of ctx.snapshots) {
    const progress = rewardObject(snapshot.progress);
    const current = Number(progress["attendance.streak.weeks.current"] ?? 0);
    const best = Number(progress["attendance.streak.weeks.best"] ?? 0);
    if (Number.isFinite(current)) currentStreak = Math.max(currentStreak, current);
    if (Number.isFinite(best)) bestStreak = Math.max(bestStreak, best);
  }

  const hasAnyContent =
    activePrograms.length > 0 ||
    activeChallenges.length > 0 ||
    recentAchievements.length > 0 ||
    availableRewards.length > 0 ||
    currentStreak > 0 ||
    bestStreak > 0;

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Mi progreso
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mi progreso
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Sigue tus metas, rachas, logros y recompensas.
        </p>
      </header>

      <Link
        href="/student/recompensas/medallero"
        className="group block overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-[radial-gradient(circle_at_88%_8%,rgba(236,72,153,0.16),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-4 transition hover:border-fuchsia-400/40 sm:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              Medallas
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">Tu Medallero</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Consulta requisitos, recompensas y tu progreso hacia Bronce, Plata, Oro o Diamante.
            </p>
          </div>
          <span aria-hidden="true" className="text-2xl text-fuchsia-300">✦</span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs font-semibold text-white">
          <span>Ver Medallero</span>
          <span aria-hidden="true" className="text-lg text-zinc-600 transition group-hover:text-fuchsia-300">›</span>
        </div>
      </Link>

      <section aria-label="Resumen de progreso" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile
          value={activePrograms.length}
          label={plural(activePrograms.length, "programa activo", "programas activos")}
          icon="◇"
        />
        <SummaryTile
          value={activeChallenges.length}
          label={plural(activeChallenges.length, "reto activo", "retos activos")}
          icon="✦"
        />
        <SummaryTile
          value={ctx.achievements.length}
          label={plural(ctx.achievements.length, "logro obtenido", "logros obtenidos")}
          icon="★"
        />
        <SummaryTile
          value={availableRewards.length}
          label={plural(
            availableRewards.length,
            "recompensa disponible",
            "recompensas disponibles",
          )}
          icon="◆"
        />
      </section>

      {!hasAnyContent ? (
        <RewardsEmpty
          title="Tu progreso empieza aquí"
          detail="Cuando avances en programas, retos, rachas o logros, tus resultados aparecerán aquí."
        />
      ) : null}

      {nearest ? (
        <section>
          <SectionHeading eyebrow="Prioridad" title="Lo más cerca de conseguir" />
          <Link
            href={nearest.href}
            className="group block overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-[radial-gradient(circle_at_88%_8%,rgba(236,72,153,0.2),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] p-5 transition hover:border-fuchsia-400/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                  {nearest.eyebrow}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-white">{nearest.title}</h2>
              </div>
              <StateChip tone="magenta">{nearest.percent}%</StateChip>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-zinc-300">{nearest.missing}</span>
                <span className="text-zinc-500">{nearest.percent}%</span>
              </div>
              <ProgressBar percent={nearest.percent} label="Progreso de la meta más cercana" />
            </div>

            {nearest.deadline ? (
              <p className="mt-3 text-xs text-zinc-400">
                Límite: {formatDateTime(nearest.deadline, ctx.studio.timezone)}
              </p>
            ) : null}

            {nearest.reward ? (
              <div className="mt-4 rounded-2xl border border-fuchsia-500/15 bg-fuchsia-500/[0.06] px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Al completar
                </p>
                <strong className="mt-1 block text-sm text-white">{nearest.reward}</strong>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end text-xs font-semibold text-fuchsia-300">
              Ver progreso →
            </div>
          </Link>
        </section>
      ) : null}

      {activePrograms.length ? (
        <section>
          <SectionHeading title="Mis programas" count={activePrograms.length} />
          <div className="grid gap-2 sm:grid-cols-2">
            {activePrograms.map((item) => {
              const displayLevel =
                item.level?.level_visibility === "hidden"
                  ? "Nivel secreto"
                  : (item.level?.title ?? "Objetivo actual");

              return (
                <Link
                  key={item.participation.id}
                  href={`/student/recompensas/programas/${item.participation.id}`}
                  className="group rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-fuchsia-500/25 hover:bg-white/[0.045]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Programa
                      </p>
                      <h3 className="mt-1 truncate text-base font-semibold text-white">
                        {item.version?.name ?? "Programa"}
                      </h3>
                    </div>
                    {item.program.status === "paused" ? (
                      <StateChip tone="warning">Pausado</StateChip>
                    ) : (
                      <StateChip tone="magenta">En progreso</StateChip>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-zinc-200">{displayLevel}</p>
                  {item.conditions.length ? (
                    <>
                      <p className="mt-1 text-xs text-zinc-500">
                        {exactMissingLabel(item.conditions)}
                      </p>
                      <div className="mt-3">
                        <ProgressBar percent={item.percent} label="Progreso del programa" />
                      </div>
                    </>
                  ) : null}
                  <p className="mt-3 text-right text-xs font-semibold text-fuchsia-300">
                    Ver programa →
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeChallenges.length ? (
        <section>
          <SectionHeading title="Retos activos" count={activeChallenges.length} />
          <div className="space-y-2">
            {activeChallenges.map((item) => {
              const reward = item.version
                ? rewardLabelFromDefinition(item.version.reward_definition)
                : null;

              return (
                <Link
                  key={item.participation.id}
                  href={`/student/recompensas/retos/${item.participation.id}`}
                  className="group block rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-fuchsia-500/25 hover:bg-white/[0.045]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Reto especial
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white">
                        {item.version?.name ?? "Reto activo"}
                      </h3>
                    </div>
                    <StateChip tone="success">Activo</StateChip>
                  </div>
                  <div className="mt-3">
                    <div className="mb-2 flex justify-between gap-3 text-xs">
                      <span className="text-zinc-300">{exactMissingLabel(item.conditions)}</span>
                      <span className="text-zinc-500">{item.percent}%</span>
                    </div>
                    <ProgressBar percent={item.percent} label="Progreso del reto" />
                  </div>
                  {item.cycle?.window_end_at ? (
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Termina {formatDateTime(item.cycle.window_end_at, ctx.studio.timezone)}
                    </p>
                  ) : null}
                  {reward ? (
                    <p className="mt-2 text-xs text-zinc-400">Recompensa: {reward}</p>
                  ) : null}
                  <p className="mt-3 text-right text-xs font-semibold text-fuchsia-300">
                    Ver reto →
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {currentStreak > 0 || bestStreak > 0 ? (
        <section>
          <SectionHeading title="Rachas" />
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Racha actual
              </p>
              <strong className="mt-2 block text-2xl font-semibold text-white">
                {currentStreak} {plural(currentStreak, "semana", "semanas")}
              </strong>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Récord
              </p>
              <strong className="mt-2 block text-2xl font-semibold text-white">
                {bestStreak} {plural(bestStreak, "semana", "semanas")}
              </strong>
            </div>
          </div>
        </section>
      ) : null}

      {recentAchievements.length ? (
        <section>
          <SectionHeading
            title="Logros recientes"
            count={ctx.achievements.length}
            href="/student/recompensas/logros"
            action="Ver todos →"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {recentAchievements.map((achievement) => (
              <Link
                key={achievement.id}
                href="/student/recompensas/logros"
                className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/10 text-lg text-amber-300"
                >
                  ★
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-white">
                    {achievement.title_snapshot}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">Conseguido</span>
                </span>
                <span className="text-lg text-zinc-600 group-hover:text-fuchsia-300">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {availableRewards.length ? (
        <section>
          <SectionHeading
            title="Recompensas disponibles"
            count={availableRewards.length}
            href="/student/recompensas/mis-recompensas"
            action="Ver todas →"
          />
          <div className="space-y-2">
            {availableRewards.slice(0, 3).map((reward) => (
              <Link
                key={reward.id}
                href={`/student/recompensas/recompensa/${reward.id}`}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] px-4 py-3 transition hover:bg-fuchsia-500/[0.1]"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                    Disponible
                  </p>
                  <strong className="mt-1 block truncate text-sm text-white">
                    {rewardBenefitLabel(reward)}
                  </strong>
                  {reward.expires_at ? (
                    <span className="mt-1 block text-[11px] text-zinc-500">
                      Vence {formatDateTime(reward.expires_at, ctx.studio.timezone)}
                    </span>
                  ) : null}
                </div>
                <span className="text-lg text-zinc-600 group-hover:text-fuchsia-300">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {hasAnyContent ? (
        <Link
          href="/student/recompensas/trayectoria"
          className="flex min-h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.025] px-4 text-sm font-semibold text-zinc-300 transition hover:border-fuchsia-500/25 hover:text-white"
        >
          <span>Ver mi trayectoria</span>
          <span aria-hidden="true" className="text-fuchsia-300">
            →
          </span>
        </Link>
      ) : null}
    </main>
  );
}
