import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  getStudentRewardsContext,
  rewardDefinitionLabel,
  rewardObject,
} from "@/lib/student/rewards";
import { conditionCompletionPercent, exactMissingLabel } from "@/lib/student/reward-progress-ui";

import { ProgressBar, StateChip } from "../../components";

function rewardLabel(value: unknown) {
  const definition = rewardObject(value);
  const rewards = Array.isArray(definition.rewards) ? definition.rewards : null;
  if (rewards && rewards.length === 0) return null;
  if (!rewards && Object.keys(definition).length === 0) return null;
  return rewardDefinitionLabel(value);
}

export default async function StudentProgramProgressPage({
  params,
}: {
  params: Promise<{ participationId: string }>;
}) {
  const { participationId } = await params;
  const ctx = await getStudentRewardsContext();
  const participation = ctx.programParticipations.find((item) => item.id === participationId);

  if (!participation) notFound();

  const program = ctx.programMap.get(participation.program_id);
  const version = ctx.programVersionMap.get(
    `${participation.program_id}:${participation.program_version_number}`,
  );
  const levels =
    ctx.levelsByProgramVersion.get(
      `${participation.program_id}:${participation.program_version_number}`,
    ) ?? [];

  if (!program || !version) notFound();

  const currentOrder = participation.current_level_order ?? levels[0]?.level_order ?? null;
  const currentLevel = levels.find((item) => item.level_order === currentOrder) ?? null;
  const ruleParticipation = currentLevel
    ? (ctx.ruleParticipationByRule.get(currentLevel.rule_id) ?? null)
    : null;
  const cycle = ruleParticipation
    ? (ctx.latestCycleByParticipation.get(ruleParticipation.id) ?? null)
    : null;
  const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
  const ruleVersion = currentLevel
    ? ctx.versionMap.get(`${currentLevel.rule_id}:${currentLevel.rule_version_number}`)
    : undefined;
  const conditions = ruleVersion ? conditionProgress(ruleVersion, snapshot) : [];
  const percent = conditionCompletionPercent(conditions);
  const unlocked = new Map(
    ctx.programUnlocks
      .filter((item) => item.participation_id === participation.id)
      .map((item) => [item.level_id, item]),
  );

  const reward = ruleVersion ? rewardLabel(ruleVersion.reward_definition) : null;
  const currentReward = currentLevel
    ? ctx.rewards.find((item) => item.rule_id === currentLevel.rule_id) ?? null
    : null;

  const snapshotProgress = rewardObject(snapshot?.progress);
  const currentStreak = Number(snapshotProgress["attendance.streak.weeks.current"] ?? 0);
  const bestStreak = Number(snapshotProgress["attendance.streak.weeks.best"] ?? currentStreak);

  const state =
    participation.status === "completed"
      ? "Completado"
      : participation.status === "closed"
        ? "Cerrado"
        : program.status === "paused"
          ? "Pausado"
          : program.status === "archived"
            ? "Archivado"
            : "En progreso";

  const stateTone =
    state === "Completado"
      ? "success"
      : state === "Pausado"
        ? "warning"
        : state === "En progreso"
          ? "magenta"
          : "neutral";

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
        >
          ← Mi progreso
        </Link>
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Programa
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {version.name}
            </h1>
            {version.description ? (
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">
                {version.description}
              </p>
            ) : null}
          </div>
          <StateChip tone={stateTone}>{state}</StateChip>
        </div>
      </header>

      {currentLevel ? (
        <section className="rounded-3xl border border-fuchsia-500/25 bg-[radial-gradient(circle_at_90%_10%,rgba(236,72,153,0.18),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            Tu objetivo actual
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {currentLevel.level_visibility === "hidden" ? "Nivel secreto" : currentLevel.title}
          </h2>
          {currentLevel.level_visibility !== "hidden" && currentLevel.description ? (
            <p className="mt-1 text-sm text-zinc-400">{currentLevel.description}</p>
          ) : null}

          {conditions.length ? (
            <>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <strong className="text-3xl font-semibold text-white">{percent}%</strong>
                  <p className="mt-1 text-xs text-zinc-400">{exactMissingLabel(conditions)}</p>
                </div>
                {cycle?.window_end_at ? (
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Periodo actual
                    </p>
                    <p className="mt-1 text-xs font-medium text-zinc-300">
                      Hasta {formatDateTime(cycle.window_end_at, ctx.studio.timezone)}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="mt-3">
                <ProgressBar percent={percent} label="Progreso del objetivo actual" />
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-zinc-400">
              Este nivel no tiene progreso cuantificable visible.
            </p>
          )}
        </section>
      ) : null}

      {conditions.length ? (
        <section>
          <div className="mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Progreso exacto
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-white">Qué cuenta y qué falta</h2>
          </div>
          <div className="space-y-2">
            {conditions.map((condition) => (
              <div
                key={condition.key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div>
                  <strong className="text-sm text-white">{condition.label}</strong>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Actual: {String(condition.current ?? 0)} · Meta: {String(condition.target)}
                  </p>
                </div>
                <StateChip tone={condition.completed ? "success" : "neutral"}>
                  {condition.completed ? "Conseguido" : "En progreso"}
                </StateChip>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(currentStreak > 0 || bestStreak > 0) && participation.status === "active" ? (
        <section>
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Constancia
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-white">Tu racha</h2>
            </div>
            <Link
              href="/student/recompensas/trayectoria?view=programs"
              className="text-xs font-semibold text-fuchsia-300"
            >
              Ver historial →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Actual</p>
              <strong className="mt-1 block text-2xl text-white">{currentStreak} semanas</strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Récord</p>
              <strong className="mt-1 block text-2xl text-white">{bestStreak} semanas</strong>
            </div>
          </div>
        </section>
      ) : null}

      {currentLevel && ruleVersion ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Recompensa del nivel
          </p>
          {currentLevel.reward_visibility === "surprise" && !unlocked.has(currentLevel.id) ? (
            <>
              <h2 className="mt-2 text-lg font-semibold text-white">Recompensa sorpresa</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Se revelará cuando completes este nivel.
              </p>
            </>
          ) : reward ? (
            <>
              <h2 className="mt-2 text-lg font-semibold text-white">{reward}</h2>
              {currentReward ? (
                <Link
                  href={`/student/recompensas/recompensa/${currentReward.id}`}
                  className="mt-3 inline-flex text-xs font-semibold text-fuchsia-300"
                >
                  Ver recompensa →
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <h2 className="mt-2 text-lg font-semibold text-white">Sin recompensa económica</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Este nivel reconoce tu avance dentro del programa.
              </p>
            </>
          )}
        </section>
      ) : null}

      <section>
        <div className="mb-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {version.progression_mode === "sequential" ? "Programa secuencial" : "Programa acumulativo"}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-white">Tu camino en el programa</h2>
        </div>

        <div className="space-y-2">
          {levels.map((level) => {
            const levelUnlock = unlocked.get(level.id);
            const isCurrent = level.level_order === currentOrder && participation.status === "active";
            const isSecret = level.level_visibility === "hidden" && !levelUnlock && !isCurrent;
            const blocked = !levelUnlock && !isCurrent;

            return (
              <div
                key={level.id}
                className={`rounded-2xl border px-4 py-3 ${isCurrent ? "border-fuchsia-500/30 bg-fuchsia-500/[0.07]" : "border-white/10 bg-white/[0.025]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Nivel {level.level_order}
                    </p>
                    <strong className="mt-1 block truncate text-sm text-white">
                      {isSecret ? "Nivel secreto" : levelUnlock?.title_snapshot ?? level.title}
                    </strong>
                    {isSecret ? (
                      <span className="mt-1 block text-[11px] text-zinc-500">
                        Sigue avanzando para descubrirlo.
                      </span>
                    ) : null}
                  </div>

                  {levelUnlock ? (
                    <StateChip tone="success">Conseguido</StateChip>
                  ) : isCurrent ? (
                    <StateChip tone="magenta">En progreso</StateChip>
                  ) : blocked ? (
                    <StateChip>Bloqueado</StateChip>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {participation.status === "completed" ? (
          <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4">
            <strong className="text-sm text-emerald-200">Programa completado</strong>
            <p className="mt-1 text-xs text-zinc-400">
              Tu recorrido permanece guardado en Mi trayectoria.
            </p>
          </div>
        ) : participation.status === "closed" || program.status === "archived" ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <strong className="text-sm text-white">Programa finalizado</strong>
            <p className="mt-1 text-xs text-zinc-400">
              Conservas los niveles y logros que alcanzaste.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
