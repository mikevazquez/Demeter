import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import EvaluationHeroCard from "../../EvaluationHeroCard";
import { MarkEvaluationResultViewed } from "./MarkEvaluationResultViewed";

type CriterionResult = {
  label: string;
  weight_percent: number;
  min_percent: number | null;
  score_percent: number | null;
  weighted_points: number | null;
  passed: boolean | null;
};

type EvaluationResultDetail = {
  id: string;
  discipline_id: string;
  discipline_name: string;
  evaluation_purpose: "diagnostic" | "placement" | "progression" | "exception";
  evaluated_level_title: string;
  resulting_level_title: string | null;
  evaluation_date: string;
  total_score: number;
  final_outcome: "approved" | "stays";
  strengths: string[];
  improvement_areas: string[];
  coach_message: string | null;
  next_objective: string | null;
  published_at: string;
  next_due_on: string | null;
  cadence_months: number | null;
  criteria: CriterionResult[];
};

function percent(value: number | null) {
  if (value === null || value === undefined) return "—";
  return Math.round(Number(value)) + "%";
}

export default async function StudentEvaluationResultPage({
  params,
}: {
  params: Promise<{ evaluationId: string }>;
}) {
  const { evaluationId } = await params;
  const { supabase, studio } = await getStudentPortalContext();

  const { data, error } = await supabase.rpc("student_evaluation_result_detail", {
    p_evaluation_id: evaluationId,
  });

  if (error || !data) notFound();

  const result = data as EvaluationResultDetail;
  const approved = result.final_outcome === "approved";
  const diagnostic = result.evaluation_purpose === "diagnostic";
  const placement = result.evaluation_purpose === "placement";
  const progression = result.evaluation_purpose === "progression";
  const confirmedLevel = diagnostic
    ? (result.resulting_level_title ?? result.evaluated_level_title)
    : placement && !approved
      ? "Sin nivel confirmado"
      : (result.resulting_level_title ?? result.evaluated_level_title);
  const levelCardLabel = diagnostic
    ? "Nivel confirmado"
    : approved
      ? placement
        ? "Nivel confirmado"
        : progression
          ? "Nuevo nivel confirmado"
          : "Nivel confirmado"
      : "Nivel confirmado";
  const heroVariant = diagnostic
    ? "diagnostic_completed"
    : progression && approved
      ? "level_up"
      : "level_maintained";
  const headline = diagnostic
    ? "Diagnóstico completado"
    : progression && approved
      ? "¡Nuevo nivel confirmado!"
      : "Se mantiene en su nivel";
  const subheadline = diagnostic
    ? "Ya tienes un nivel técnico confirmado."
    : progression && approved
      ? "Tu dedicación y esfuerzo dan resultados."
      : "Tu nivel técnico se mantiene. ¡Vas por buen camino!";
  const levelSupport = diagnostic
    ? "Este es tu punto de partida técnico. A partir de aquí comienza tu ciclo de progresión."
    : progression && approved
      ? "Has superado con éxito la evaluación. Sigue explorando nuevos retos y perfeccionando tu técnica."
      : "Mantienes un buen progreso en tu práctica. Sigue entrenando con constancia para consolidar tu técnica y ganar más seguridad.";

  return (
    <main className="mx-auto max-w-3xl space-y-3 pb-4">
      <MarkEvaluationResultViewed evaluationId={result.id} />
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/student/evaluaciones"
          aria-label="Volver a evaluaciones"
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.025] text-xl text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
        >
          ‹
        </Link>
        <span className="text-[10px] font-semibold uppercase tracking-[0.34em] text-zinc-400">
          Studio <span className="text-fuchsia-400">Flow</span>
        </span>
        <span className="h-10 w-10" aria-hidden="true" />
      </div>

      <EvaluationHeroCard
        variant={heroVariant}
        disciplineName={result.discipline_name}
        levelName={confirmedLevel}
      />

      <section className="px-1 pt-2">
        <h2 className="text-3xl font-semibold tracking-tight text-white">{headline}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{subheadline}</p>
      </section>

      <section className="flex items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-white/[0.025] p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fuchsia-500/[0.12] text-xl text-fuchsia-400"
          >
            ✦
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-base text-white">
              {result.discipline_name}
            </strong>
            <p className="mt-0.5 text-xs text-zinc-400">
              Nivel evaluado: {result.evaluated_level_title}
            </p>
          </div>
        </div>
        <span aria-hidden="true" className="text-xl text-zinc-500">
          ›
        </span>
      </section>

      <section
        className={
          "rounded-[24px] border p-4 " +
          (approved || diagnostic
            ? "border-fuchsia-500/45 bg-fuchsia-500/[0.055]"
            : "border-fuchsia-500/35 bg-white/[0.02]")
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-zinc-400">{levelCardLabel}</p>
            <strong className="mt-1 block text-3xl font-semibold tracking-tight text-fuchsia-400">
              {confirmedLevel}
            </strong>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-zinc-400">{levelSupport}</p>
          </div>
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-fuchsia-500/[0.12] text-2xl text-fuchsia-400"
          >
            {diagnostic || approved ? "✓" : "="}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="text-xl text-fuchsia-400">
              ▣
            </span>
            <div>
              <p className="text-[10px] text-zinc-500">Fecha de evaluación</p>
              <strong className="mt-0.5 block text-base text-white">
                {formatDate(result.evaluation_date, studio.timezone, studio.locale)}
              </strong>
            </div>
          </div>
        </div>
        <div className="rounded-[22px] border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="text-xl text-fuchsia-400">
              ☆
            </span>
            <div>
              <p className="text-[10px] text-zinc-500">Puntuación total</p>
              <strong className="mt-0.5 block text-base text-white">
                {percent(result.total_score)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      {result.criteria.length ? (
        <section className="rounded-[24px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_90%_0%,rgba(236,72,153,0.08),transparent_36%),rgba(255,255,255,0.02)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
            Desglose de puntaje
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Tu evaluación</h2>

          <div className="mt-4 divide-y divide-white/[0.06]">
            {result.criteria.map((criterion) => {
              const score = Math.max(0, Math.min(100, Number(criterion.score_percent ?? 0)));
              return (
                <div
                  key={criterion.label}
                  className="grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="truncate text-xs font-medium text-zinc-200">
                    {criterion.label}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <span
                      className="block h-full rounded-full bg-fuchsia-500"
                      style={{ width: `${score}%` }}
                    />
                  </span>
                  <strong className="text-xs text-white">{percent(criterion.score_percent)}</strong>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {result.coach_message || result.strengths?.length || result.improvement_areas?.length ? (
        <section className="rounded-[24px] border border-fuchsia-500/30 bg-fuchsia-500/[0.035] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Feedback de tu coach
          </p>
          {result.coach_message ? (
            <p className="mt-3 text-sm leading-6 text-zinc-200">{result.coach_message}</p>
          ) : null}
          {result.strengths?.length ? (
            <p className="mt-3 text-xs leading-5 text-zinc-300">
              <strong className="text-white">Fortalezas:</strong> {result.strengths.join(", ")}.
            </p>
          ) : null}
          {result.improvement_areas?.length ? (
            <p className="mt-2 text-xs leading-5 text-zinc-300">
              <strong className="text-white">A seguir trabajando:</strong>{" "}
              {result.improvement_areas.join(", ")}.
            </p>
          ) : null}
          {result.next_objective ? (
            <p className="mt-2 text-xs leading-5 text-zinc-300">
              <strong className="text-white">Próximo objetivo:</strong> {result.next_objective}.
            </p>
          ) : null}
        </section>
      ) : null}

      {result.next_due_on ? (
        <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Siguiente evaluación
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <span className="text-xs text-zinc-500">Disponible a partir del</span>
              <strong className="mt-1 block text-lg text-white">
                {formatDate(result.next_due_on, studio.timezone, studio.locale)}
              </strong>
            </div>
            {result.cadence_months ? (
              <span className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                en {result.cadence_months} meses
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-[24px] border border-fuchsia-500/25 bg-[linear-gradient(110deg,rgba(112,26,75,0.35),rgba(236,72,153,0.04))] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span aria-hidden="true" className="text-lg text-fuchsia-400">
              “
            </span>
            <p className="mt-1 text-sm italic text-zinc-200">
              {diagnostic
                ? "Tu punto de partida ya está confirmado."
                : approved
                  ? "Disciplina de hoy, resultados de mañana."
                  : "La constancia también es progreso."}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {diagnostic
                ? "Tu siguiente evaluación llegará dentro de tu ciclo trimestral."
                : approved
                  ? "Sigue explorando tu potencial."
                  : "Sigue disfrutando tu proceso."}
            </p>
          </div>
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Studio <span className="text-fuchsia-400">Flow</span>
          </span>
        </div>
      </section>

      <Link
        href="/student/evaluaciones"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
      >
        Ver historial de evaluaciones
      </Link>
    </main>
  );
}
