import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  getStudentRewardsContext,
  rewardDefinitionLabel,
  rewardObject,
} from "@/lib/student/rewards";
import { conditionCompletionPercent, exactMissingLabel } from "@/lib/student/reward-progress-ui";

import { ProgressBar, RewardsEmpty, StateChip } from "../components";

const views = [
  { key: "all", label: "Todos" },
  { key: "unlocked", label: "Conseguidos" },
  { key: "progress", label: "En progreso" },
] as const;

const origins = [
  { key: "all", label: "Todos" },
  { key: "programs", label: "Programas" },
  { key: "challenges", label: "Retos" },
  { key: "independent", label: "Independientes" },
] as const;

function rewardLabel(value: unknown) {
  const definition = rewardObject(value);
  const rewards = Array.isArray(definition.rewards) ? definition.rewards : null;
  if (rewards && rewards.length === 0) return null;
  if (!rewards && Object.keys(definition).length === 0) return null;
  return rewardDefinitionLabel(value);
}

function originForRule(ruleId: string, presentationValue: unknown, programRuleIds: Set<string>) {
  if (programRuleIds.has(ruleId)) return "programs";
  const presentation = rewardObject(presentationValue);
  const origin = String(presentation.origin_type ?? presentation.origin ?? "");
  if (origin === "challenge") return "challenges";
  return "independent";
}

function originLabel(origin: string) {
  if (origin === "programs") return "Programa";
  if (origin === "challenges") return "Reto";
  return "Independiente";
}

export default async function StudentAchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; origin?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getStudentRewardsContext();
  const activeView = views.some((item) => item.key === query.view) ? query.view! : "all";
  const activeOrigin = origins.some((item) => item.key === query.origin) ? query.origin! : "all";

  const unlocked = ctx.achievements.map((achievement) => {
    const version = ctx.versionMap.get(
      `${achievement.rule_id}:${achievement.version_number}`,
    );
    const origin = originForRule(
      achievement.rule_id,
      version?.presentation_definition,
      ctx.programRuleIds,
    );

    return {
      achievement,
      version,
      origin,
      reward: version ? rewardLabel(version.reward_definition) : null,
    };
  });

  const unlockedRuleIds = new Set(ctx.achievements.map((item) => item.rule_id));

  const progressItems = ctx.participations
    .map((participation) => {
      const version = ctx.versionMap.get(
        `${participation.rule_id}:${participation.joined_version_number}`,
      );
      if (!version || version.family !== "achievement" || unlockedRuleIds.has(participation.rule_id)) {
        return null;
      }

      const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
      const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
      const conditions = conditionProgress(version, snapshot);
      const presentation = rewardObject(version.presentation_definition);
      const hidden = presentation.hidden_until_unlocked === true;
      const origin = originForRule(
        participation.rule_id,
        version.presentation_definition,
        ctx.programRuleIds,
      );

      return {
        participation,
        version,
        conditions,
        hidden,
        origin,
        percent: conditionCompletionPercent(conditions),
        reward: rewardLabel(version.reward_definition),
      };
    })
    .filter(Boolean) as Array<{
      participation: (typeof ctx.participations)[number];
      version: (typeof ctx.versions)[number];
      conditions: ReturnType<typeof conditionProgress>;
      hidden: boolean;
      origin: string;
      percent: number;
      reward: string | null;
    }>;

  const visibleProgress = progressItems.filter((item) => !item.hidden);
  const secretCount = progressItems.filter((item) => item.hidden).length;

  const filteredUnlocked = unlocked.filter(
    (item) => activeOrigin === "all" || item.origin === activeOrigin,
  );
  const filteredProgress = visibleProgress.filter(
    (item) => activeOrigin === "all" || item.origin === activeOrigin,
  );

  const showUnlocked = activeView === "all" || activeView === "unlocked";
  const showProgress = activeView === "all" || activeView === "progress";

  function filterHref(view: string, origin: string) {
    const params = new URLSearchParams();
    if (view !== "all") params.set("view", view);
    if (origin !== "all") params.set("origin", origin);
    const value = params.toString();
    return value ? `/student/recompensas/logros?${value}` : "/student/recompensas/logros";
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
          Mi progreso
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mis logros
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Cada clase cuenta. Aquí está tu trayectoria.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <strong className="text-xl text-white">{ctx.achievements.length}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">conseguidos</p>
        </div>
        <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-3.5">
          <strong className="text-xl text-white">{visibleProgress.length}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">en progreso</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <strong className="text-xl text-white">{secretCount}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">secretos</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {views.map((item) => {
              const count =
                item.key === "unlocked"
                  ? ctx.achievements.length
                  : item.key === "progress"
                    ? visibleProgress.length
                    : ctx.achievements.length + visibleProgress.length;

              return (
                <Link
                  key={item.key}
                  href={filterHref(item.key, activeOrigin)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeView === item.key ? "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}
                >
                  {item.label} ({count})
                </Link>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {origins.map((item) => (
              <Link
                key={item.key}
                href={filterHref(activeView, item.key)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${activeOrigin === item.key ? "bg-white/10 text-white" : "bg-transparent text-zinc-500 hover:text-zinc-300"}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {showUnlocked && filteredUnlocked.length ? (
        <section>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Colección
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-white">Conseguidos</h2>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredUnlocked.map((item) => (
              <div
                key={item.achievement.id}
                className="rounded-3xl border border-amber-400/15 bg-[radial-gradient(circle_at_90%_10%,rgba(251,191,36,0.09),transparent_35%),rgba(255,255,255,0.025)] p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10 text-xl text-amber-200"
                  >
                    ★
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                          {originLabel(item.origin)}
                        </p>
                        <h3 className="mt-1 truncate text-base font-semibold text-white">
                          {item.achievement.title_snapshot}
                        </h3>
                      </div>
                      <StateChip tone="success">Conseguido</StateChip>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      {formatDateTime(item.achievement.unlocked_at, ctx.studio.timezone)}
                    </p>
                    {item.version?.human_summary ? (
                      <p className="mt-2 text-xs leading-5 text-zinc-400">
                        {item.version.human_summary}
                      </p>
                    ) : null}
                    {item.reward ? (
                      <p className="mt-2 text-xs font-medium text-fuchsia-300">
                        {item.reward}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showProgress && filteredProgress.length ? (
        <section>
          <div className="mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Próximos hitos
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-white">En progreso</h2>
          </div>
          <div className="space-y-2">
            {filteredProgress.map((item) => (
              <div
                key={item.participation.id}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {originLabel(item.origin)}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-white">{item.version.name}</h3>
                  </div>
                  <StateChip tone="magenta">En progreso</StateChip>
                </div>
                <p className="mt-2 text-xs text-zinc-400">{exactMissingLabel(item.conditions)}</p>
                <div className="mt-3">
                  <ProgressBar percent={item.percent} label={item.version.name} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{item.percent}%</span>
                  {item.reward ? (
                    <span>Al completar: {item.reward}</span>
                  ) : (
                    <span>Sin recompensa económica</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeView === "all" && activeOrigin === "all" && secretCount > 0 ? (
        <section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-lg text-zinc-500"
            >
              ?
            </span>
            <div>
              <strong className="text-sm text-white">
                {secretCount === 1 ? "1 logro secreto" : `${secretCount} logros secretos`}
              </strong>
              <p className="mt-1 text-xs text-zinc-500">
                Algunos logros se revelan cuando cumples sus condiciones.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {(!showUnlocked || !filteredUnlocked.length) &&
      (!showProgress || !filteredProgress.length) &&
      !(activeView === "all" && activeOrigin === "all" && secretCount > 0) ? (
        <RewardsEmpty
          title="Aún no tienes logros en esta vista"
          detail="Cuando alcances tus primeros hitos, aparecerán aquí."
          actionHref="/student/reservar"
          actionLabel="Explorar clases"
        />
      ) : null}
    </main>
  );
}
