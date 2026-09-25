import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  getStudentRewardsContext,
  isChallengeVersion,
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

function currentTimeMs() {
  return Date.now();
}

function daysRemaining(date: string | null) {
  if (!date) return null;
  const distance = Date.parse(date) - currentTimeMs();
  if (!Number.isFinite(distance)) return null;
  return Math.max(0, Math.ceil(distance / 86_400_000));
}

function isFutureDate(date: string | null) {
  return Boolean(date && Date.parse(date) > currentTimeMs());
}

function isPastDate(date: string | null) {
  return Boolean(date && Date.parse(date) < currentTimeMs());
}

export default async function StudentChallengeDetailPage({
  params,
}: {
  params: Promise<{ participationId: string }>;
}) {
  const { participationId } = await params;
  const ctx = await getStudentRewardsContext();
  const participation = ctx.participations.find((item) => item.id === participationId);

  if (!participation) notFound();

  const rule = ctx.ruleMap.get(participation.rule_id);
  const version = ctx.versionMap.get(
    `${participation.rule_id}:${participation.joined_version_number}`,
  );

  if (
    !rule ||
    !version ||
    ctx.programRuleIds.has(participation.rule_id) ||
    !isChallengeVersion(version)
  ) {
    notFound();
  }

  const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
  const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
  const conditions = conditionProgress(version, snapshot);
  const percent = conditionCompletionPercent(conditions);
  const presentation = rewardObject(version.presentation_definition);
  const reward = rewardLabel(version.reward_definition);
  const rewardVisibility = String(presentation.reward_visibility ?? "visible");
  const generatedReward =
    ctx.rewards.find((item) => item.rule_id === participation.rule_id) ?? null;

  const startAt = rule.scheduled_start_at ?? cycle?.window_start_at ?? null;
  const endAt = rule.scheduled_end_at ?? cycle?.window_end_at ?? null;
  const startsLater = isFutureDate(startAt);
  const endedByDate = isPastDate(endAt);
  const completed = participation.status === "fulfilled" || cycle?.status === "fulfilled";
  const periodFailed = cycle?.status === "closed_incomplete" && !completed;
  const finalized =
    !completed &&
    (endedByDate ||
      ["finished", "cancelled"].includes(rule.status) ||
      ["closed_incomplete", "cancelled"].includes(cycle?.status ?? ""));
  const remaining = daysRemaining(endAt);

  const state = completed
    ? "Completado"
    : startsLater || rule.status === "scheduled"
      ? "Próximamente"
      : periodFailed
        ? "Periodo no completado"
        : finalized
          ? "Finalizado"
          : "Activo";

  const stateTone =
    state === "Completado"
      ? "success"
      : state === "Activo"
        ? "success"
        : state === "Próximamente"
          ? "magenta"
          : state === "Periodo no completado"
            ? "warning"
            : "neutral";

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
        >
          ← Medallas y beneficios
        </Link>

        <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_84%_10%,rgba(236,72,153,0.2),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
                Reto especial
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {version.name}
              </h1>
            </div>
            <StateChip tone={stateTone}>{state}</StateChip>
          </div>

          {version.description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{version.description}</p>
          ) : null}

          {startAt || endAt ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-xs text-zinc-400">
              {startAt ? <span>Inicio: {formatDateTime(startAt, ctx.studio.timezone)}</span> : null}
              {endAt ? <span>Fin: {formatDateTime(endAt, ctx.studio.timezone)}</span> : null}
            </div>
          ) : null}

          {!completed && !finalized && !startsLater && remaining !== null ? (
            <p
              className={`mt-3 text-xs font-semibold ${remaining <= 2 ? "text-orange-300" : "text-zinc-300"}`}
            >
              {remaining <= 2 ? `Últimos ${remaining} días` : `Termina en ${remaining} días`}
            </p>
          ) : startsLater && startAt ? (
            <p className="mt-3 text-xs font-semibold text-fuchsia-300">
              Comienza en {daysRemaining(startAt)} días
            </p>
          ) : null}
        </div>
      </header>

      <section className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Tu progreso
        </p>

        {startsLater ? (
          <>
            <h2 className="mt-2 text-xl font-semibold text-white">Todavía no comienza</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Tu progreso empezará a contar cuando inicie el periodo del reto.
            </p>
          </>
        ) : (
          <>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <strong className="text-3xl font-semibold text-white">{percent}%</strong>
                <p className="mt-1 text-xs text-zinc-400">
                  {completed
                    ? "Meta completada"
                    : finalized
                      ? conditions.length
                        ? exactMissingLabel(conditions)
                        : "Reto finalizado"
                      : exactMissingLabel(conditions)}
                </p>
              </div>
              {conditions.length === 1 &&
              typeof conditions[0]?.current === "number" &&
              typeof conditions[0]?.target === "number" ? (
                <strong className="text-lg text-zinc-300">
                  {conditions[0].current} / {conditions[0].target}
                </strong>
              ) : null}
            </div>
            <div className="mt-3">
              <ProgressBar percent={percent} label="Progreso del reto especial" />
            </div>
          </>
        )}

        {completed ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-3.5">
            <strong className="text-sm text-emerald-200">¡Reto completado!</strong>
            <p className="mt-1 text-xs text-zinc-400">
              Cumpliste la meta dentro del periodo del reto.
            </p>
          </div>
        ) : periodFailed ? (
          <div className="mt-4 rounded-2xl border border-orange-400/20 bg-orange-400/[0.07] p-3.5">
            <strong className="text-sm text-orange-200">Periodo no completado</strong>
            <p className="mt-1 text-xs text-zinc-400">
              Este periodo ya cerró y no puede completarse después de su fecha límite.
            </p>
          </div>
        ) : finalized ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3.5">
            <strong className="text-sm text-white">Este reto ya terminó</strong>
            <p className="mt-1 text-xs text-zinc-400">
              {conditions.length
                ? exactMissingLabel(conditions)
                : "El periodo terminó sin completar la meta."}
            </p>
          </div>
        ) : null}
      </section>

      {conditions.length > 1 ? (
        <section>
          <div className="mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Condiciones
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-white">Progreso por objetivo</h2>
          </div>
          <div className="space-y-2">
            {conditions.map((condition) => {
              const conditionPercent =
                typeof condition.current === "number" &&
                typeof condition.target === "number" &&
                condition.target > 0
                  ? Math.max(
                      0,
                      Math.min(100, Math.round((condition.current / condition.target) * 100)),
                    )
                  : condition.completed
                    ? 100
                    : 0;

              return (
                <div
                  key={condition.key}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">{condition.label}</strong>
                    <span className="text-xs text-zinc-500">
                      {String(condition.current ?? 0)} / {String(condition.target)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar percent={conditionPercent} label={condition.label} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Recompensa
        </p>

        {rewardVisibility === "surprise" && !completed ? (
          <>
            <h2 className="mt-2 text-lg font-semibold text-white">Recompensa sorpresa</h2>
            <p className="mt-1 text-sm text-zinc-400">Se revelará cuando completes el reto.</p>
          </>
        ) : reward ? (
          <>
            <h2 className="mt-2 text-lg font-semibold text-white">{reward}</h2>
            {generatedReward ? (
              <Link
                href={`/student/recompensas/recompensa/${generatedReward.id}`}
                className="mt-3 inline-flex text-xs font-semibold text-fuchsia-300"
              >
                {generatedReward.kind === "badge" ? "Ver medalla →" : "Ver recompensa →"}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="mt-2 text-lg font-semibold text-white">Sin recompensa económica</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Este reto reconoce tu avance sin otorgar un beneficio económico.
            </p>
          </>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Cómo funciona
        </p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          La participación es automática cuando cumples la elegibilidad del reto. Solo cuentan los
          eventos definidos en sus condiciones; no necesitas inscribirte manualmente.
        </p>
      </section>
    </main>
  );
}
