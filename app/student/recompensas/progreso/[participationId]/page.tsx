import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/student/portal";
import {
  conditionProgress,
  exactMissingLabel,
  familyLabel,
  getStudentRewardsContext,
  rewardDefinitionLabel,
  rewardObject,
  singleNumericProgress,
} from "@/lib/student/rewards";

function guidance(family: string, evaluation: Record<string, unknown>) {
  if (family === "loyalty") {
    return {
      counts:
        "Cuenta cada periodo activo real de paquete o membresía que cumpla las reglas de pago de esta campaña.",
      excludes:
        "Una compra anticipada no suma hasta que el nuevo periodo entra en vigor. Extender la vigencia no crea un periodo adicional.",
    };
  }

  if (family === "attendance" || family === "challenge") {
    return {
      counts: "Solo suma una clase cuando la asistencia queda registrada como “Asistió”.",
      excludes:
        evaluation.attendance_max_one_per_day === true
          ? "Como máximo cuenta una asistencia por día para esta regla. Reservar por sí solo no suma."
          : "Reservar por sí solo no suma. Cancelaciones y no-show no agregan progreso.",
    };
  }

  return {
    counts: "El avance se actualiza a partir de eventos reales registrados en Studio Flow.",
    excludes: "Los eventos que no cumplen la condición de la regla no incrementan el progreso.",
  };
}

export default async function StudentRewardProgressPage({
  params,
}: {
  params: Promise<{ participationId: string }>;
}) {
  const { participationId } = await params;
  const ctx = await getStudentRewardsContext();
  const participation = ctx.participations.find((item) => item.id === participationId);

  if (!participation) notFound();

  const version = ctx.versionMap.get(
    `${participation.rule_id}:${participation.joined_version_number}`,
  );
  if (!version) notFound();

  const presentation = rewardObject(version.presentation_definition);
  if (presentation.progress_visible === false || presentation.hidden_until_unlocked === true) {
    notFound();
  }

  const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
  const snapshot = cycle ? (ctx.latestSnapshotByCycle.get(cycle.id) ?? null) : null;
  const conditions = conditionProgress(version, snapshot);
  const numeric = singleNumericProgress(conditions);
  const evaluation = rewardObject(version.evaluation_definition);
  const copy = guidance(version.family, evaluation);
  const frozen = cycle?.status === "frozen";
  const fulfilled =
    participation.status === "fulfilled" || cycle?.status === "fulfilled";

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
          {familyLabel(version.family)}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {version.name}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          {version.human_summary}
        </p>
      </header>

      <section
        className={
          fulfilled
            ? "rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5"
            : frozen
              ? "rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-5"
              : "rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-5"
        }
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          {fulfilled ? "COMPLETADO" : frozen ? "PROGRESO EN PAUSA" : "TU PROGRESO"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          {fulfilled ? "Meta completada" : exactMissingLabel(conditions)}
        </h2>

        {numeric ? (
          <div className="mt-4">
            <div
              className="h-2 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={numeric.target}
              aria-valuenow={numeric.current}
            >
              <div
                className="h-full rounded-full bg-fuchsia-500"
                style={{ width: `${numeric.percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
              <span>{numeric.current} actual</span>
              <span>{numeric.target} meta</span>
            </div>
          </div>
        ) : conditions.length > 1 ? (
          <p className="mt-3 text-xs text-zinc-400">
            {conditions.filter((condition) => condition.completed).length} de {conditions.length}{" "}
            condiciones completas. Se muestran por separado para no mezclar metas distintas en un
            porcentaje único.
          </p>
        ) : null}

        {cycle?.window_end_at ? (
          <p className="mt-4 border-t border-white/10 pt-3 text-xs text-zinc-400">
            Fecha límite:{" "}
            <strong className="text-white">
              {formatDateTime(cycle.window_end_at, ctx.studio.timezone)}
            </strong>
          </p>
        ) : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
          QUÉ TE FALTA
        </p>
        <div className="mt-4 grid gap-3">
          {conditions.length ? (
            conditions.map((condition) => (
              <article
                key={condition.key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div>
                  <strong className="text-sm text-white">{condition.label}</strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    Actual: {String(condition.current ?? 0)} · Meta: {String(condition.target)}
                  </p>
                </div>
                <span
                  className={
                    condition.completed
                      ? "rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300"
                      : "rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200"
                  }
                >
                  {condition.completed ? "Completa" : "Pendiente"}
                </span>
              </article>
            ))
          ) : (
            <p className="text-sm text-zinc-400">
              Esta regla todavía no tiene una condición visible para mostrar.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            SÍ CUENTA
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{copy.counts}</p>
        </article>
        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            NO CUENTA
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{copy.excludes}</p>
        </article>
      </section>

      <section className="rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.08] via-white/[0.03] to-transparent p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
          RECOMPENSA
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          {rewardDefinitionLabel(version.reward_definition)}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Se genera cuando Studio Flow confirma que cumpliste todas las condiciones aplicables.
        </p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          ESTADO DEL CICLO
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-black/20 p-4">
            <span className="text-xs text-zinc-500">Estado</span>
            <strong className="mt-1 block text-white">
              {fulfilled
                ? "Cumplido"
                : frozen
                  ? "Pausado"
                  : participation.status === "closed"
                    ? "Finalizado"
                    : "En progreso"}
            </strong>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <span className="text-xs text-zinc-500">Última actualización</span>
            <strong className="mt-1 block text-white">
              {formatDateTime(
                snapshot?.calculated_at ?? cycle?.updated_at ?? participation.updated_at,
                ctx.studio.timezone,
              )}
            </strong>
          </div>
        </div>
      </section>
    </main>
  );
}
