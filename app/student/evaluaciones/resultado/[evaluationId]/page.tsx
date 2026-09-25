import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

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

  const resultLabel = diagnostic
    ? "Resultado del diagnóstico"
    : progression
      ? "Resultado de tu evaluación"
      : "Nivel técnico confirmado";

  const headline = diagnostic
    ? "Tu nivel técnico es"
    : progression && approved
      ? `¡Subiste a ${confirmedLevel}!`
      : placement && !approved
        ? "Aún no hay un nivel confirmado"
        : `Tu nivel sigue siendo ${confirmedLevel}`;

  const explanation = diagnostic
    ? "Este es el nivel más alto que demostraste durante tu diagnóstico."
    : progression && approved
      ? "Tu nuevo nivel técnico ya está confirmado."
      : placement && !approved
        ? "Tu coach seguirá trabajando contigo antes de confirmar un nivel técnico."
        : `Hay elementos que ya dominas y otros que todavía necesitan consolidarse antes de avanzar desde ${confirmedLevel}.`;

  return (
    <main className="mx-auto max-w-3xl space-y-4 pb-4">
      <MarkEvaluationResultViewed evaluationId={result.id} />

      <Link
        href="/student/evaluaciones"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
      >
        <span aria-hidden="true">←</span>
        Nivel técnico
      </Link>

      <section className="student-card overflow-hidden border-cyan-400/20 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,0.1),transparent_38%),rgba(255,255,255,0.025)] p-5 sm:p-6">
        <p className="student-eyebrow">{resultLabel}</p>
        <p className="mt-3 text-sm font-semibold text-zinc-300">{result.discipline_name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{headline}</h1>
        <p className="mt-3 text-4xl font-semibold tracking-tight text-cyan-200 sm:text-5xl">
          {confirmedLevel}
        </p>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{explanation}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="student-card p-4">
          <p className="text-xs text-zinc-500">Fecha de evaluación</p>
          <strong className="mt-1 block text-base text-white">
            {formatDate(result.evaluation_date, studio.timezone)}
          </strong>
        </div>
        <div className="student-card p-4">
          <p className="text-xs text-zinc-500">Puntuación total</p>
          <strong className="mt-1 block text-base text-white">{percent(result.total_score)}</strong>
        </div>
      </section>

      {result.criteria.length ? (
        <section className="student-card p-4 sm:p-5">
          <p className="student-eyebrow">Tu evaluación</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Criterios técnicos</h2>

          <div className="mt-4 divide-y divide-white/[0.06]">
            {result.criteria.map((criterion) => {
              const score = Math.max(0, Math.min(100, Number(criterion.score_percent ?? 0)));
              return (
                <div
                  key={criterion.label}
                  className="grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="truncate text-sm font-medium text-zinc-200">
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
        <section className="student-card p-4 sm:p-5">
          <p className="student-eyebrow">Tu coach</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Feedback de tu evaluación</h2>

          {result.coach_message ? (
            <p className="mt-3 text-sm leading-6 text-zinc-200">{result.coach_message}</p>
          ) : null}

          {result.strengths?.length ? (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
              <p className="text-sm font-semibold text-emerald-200">Lo que hiciste bien</p>
              <p className="mt-1 text-sm leading-6 text-zinc-300">{result.strengths.join(", ")}.</p>
            </div>
          ) : null}

          {result.improvement_areas?.length ? (
            <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
              <p className="text-sm font-semibold text-amber-100">Lo que vamos a trabajar</p>
              <p className="mt-1 text-sm leading-6 text-zinc-300">
                {result.improvement_areas.join(", ")}.
              </p>
            </div>
          ) : null}

          {result.next_objective ? (
            <p className="mt-4 text-sm leading-6 text-zinc-300">
              <strong className="font-semibold text-white">Próximo objetivo:</strong>{" "}
              {result.next_objective}.
            </p>
          ) : null}
        </section>
      ) : null}

      {result.next_due_on ? (
        <section className="student-card p-4">
          <p className="student-eyebrow">Siguiente evaluación</p>
          <p className="mt-2 text-sm text-zinc-400">
            Podrás volver a evaluarte a partir del{" "}
            <strong className="font-semibold text-white">
              {formatDate(result.next_due_on, studio.timezone)}
            </strong>
            .
          </p>
        </section>
      ) : null}

      <Link href="/student/evaluaciones" className="student-action-primary w-full">
        Volver a Nivel técnico
      </Link>
    </main>
  );
}
