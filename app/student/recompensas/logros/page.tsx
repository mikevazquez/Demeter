import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  exactMissingLabel,
  getStudentRewardsContext,
  rewardObject,
  singleNumericProgress,
} from "@/lib/student/rewards";

import { RewardsEmpty } from "../components";

function achievementCategory(value: unknown) {
  const object = rewardObject(value);
  return String(object.category ?? "Trayectoria");
}

export default async function StudentAchievementsPage() {
  const ctx = await getStudentRewardsContext();

  const inProgress = ctx.participations
    .map((participation) => {
      const version = ctx.versionMap.get(
        `${participation.rule_id}:${participation.joined_version_number}`,
      );
      if (!version || version.family !== "achievement" || participation.status === "closed") {
        return null;
      }

      const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
      const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
      const presentation = rewardObject(version.presentation_definition);
      const conditions = conditionProgress(version, snapshot);

      return {
        participation,
        version,
        cycle,
        conditions,
        hidden: presentation.hidden_until_unlocked === true,
      };
    })
    .filter(Boolean) as Array<{
    participation: (typeof ctx.participations)[number];
    version: (typeof ctx.versions)[number];
    cycle: (typeof ctx.cycles)[number] | null;
    conditions: ReturnType<typeof conditionProgress>;
    hidden: boolean;
  }>;

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
          LOGROS
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Tu trayectoria
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Son marcas permanentes de tu recorrido. No hay puntos, niveles globales ni rankings entre
          alumnas.
        </p>
      </header>

      {ctx.achievements.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              DESBLOQUEADOS
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Tus logros</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {ctx.achievements.map((achievement) => (
              <article
                key={achievement.id}
                className="rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.08] via-white/[0.03] to-transparent p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10 text-xl text-fuchsia-300"
                  >
                    ◇
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                    Desbloqueado
                  </span>
                </div>
                <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {achievementCategory(achievement.badge_snapshot)}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  {achievement.title_snapshot}
                </h3>
                {achievement.level_key ? (
                  <p className="mt-1 text-xs text-fuchsia-300">Etapa {achievement.level_key}</p>
                ) : null}
                <p className="mt-3 text-xs text-zinc-500">
                  {formatDateTime(achievement.unlocked_at, ctx.studio.timezone)}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {inProgress.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              PRÓXIMOS HITOS
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">En progreso</h2>
          </div>
          <div className="grid gap-3">
            {inProgress.map((item) => {
              const numeric = singleNumericProgress(item.conditions);
              return (
                <Link
                  key={item.participation.id}
                  href={
                    item.hidden
                      ? "/student/recompensas/logros"
                      : `/student/recompensas/progreso/${item.participation.id}`
                  }
                  className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                    {item.hidden ? "LOGRO SORPRESA" : "PRÓXIMO LOGRO"}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    {item.hidden ? "Sigue avanzando para descubrirlo" : item.version.name}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-400">
                    {item.hidden
                      ? "Este logro se revelará cuando cumplas su condición."
                      : exactMissingLabel(item.conditions)}
                  </p>
                  {!item.hidden && numeric ? (
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
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {!ctx.achievements.length && !inProgress.length ? (
        <RewardsEmpty
          title="Tu colección empieza aquí"
          detail="Tus logros permanentes aparecerán cuando alcances hitos de trayectoria, constancia, fidelidad o exploración."
          actionHref="/student/recompensas"
          actionLabel="Volver a Rewards"
        />
      ) : null}
    </main>
  );
}
