import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

type CriterionResult = {
  label: string;
  weight_percent: number;
  min_percent: number;
  score_percent: number | null;
  weighted_points: number | null;
  passed: boolean | null;
};

type EvaluationResultDetail = {
  id: string;
  discipline_id: string;
  discipline_name: string;
  evaluation_purpose: "placement" | "progression" | "exception";
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
  const placement = result.evaluation_purpose === "placement";
  const promoted =
    !placement &&
    approved &&
    Boolean(result.resulting_level_title) &&
    result.resulting_level_title !== result.evaluated_level_title;
  const currentLevelCopy =
    placement && !approved
      ? "Sin nivel confirmado"
      : (result.resulting_level_title ?? result.evaluated_level_title);

  return (
    <main className="space-y-5 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Evaluaciones
      </Link>

      <section
        className={
          "overflow-hidden rounded-[30px] border bg-[radial-gradient(circle_at_85%_0%,rgba(236,72,153,0.16),transparent_34%),linear-gradient(150deg,#151018,#0c1016)] " +
          (approved
            ? "border-emerald-400/30 shadow-[0_0_38px_rgba(16,185,129,0.08)]"
            : "border-amber-400/30 shadow-[0_0_38px_rgba(245,158,11,0.07)]")
        }
      >
        <div className="p-5 sm:p-6">
          <span
            className={
              "inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] " +
              (approved
                ? "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-300"
                : "border-amber-400/35 bg-amber-400/[0.08] text-amber-300")
            }
          >
            {approved ? "Aprobada" : "Permanece"}
          </span>

          <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            {result.discipline_name}
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {placement
              ? approved
                ? "¡Nivel confirmado!"
                : "Nivel todavía no confirmado"
              : approved
                ? promoted
                  ? "¡Subiste de nivel!"
                  : "¡Nivel aprobado!"
                : "Te mantienes en tu nivel"}
          </h1>

          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {placement
              ? approved
                ? "Tu evaluación de colocación confirmó el nivel técnico que tu coach quería validar."
                : "La evaluación de colocación terminó, pero este nivel todavía no queda confirmado."
              : approved
                ? promoted
                  ? "Tu resultado cumplió automáticamente con los criterios técnicos de progresión."
                  : "Cumpliste automáticamente con los criterios técnicos definidos para este nivel."
                : "Completaste la evaluación, pero todavía hay objetivos técnicos por consolidar antes de avanzar."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Resultado</p>
              <strong className="mt-1 block text-xl text-white">
                {percent(result.total_score)}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Nivel evaluado</p>
              <strong className="mt-1 block text-sm text-white">
                {result.evaluated_level_title}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Nivel actual</p>
              <strong
                className={
                  "mt-1 block text-sm " + (approved ? "text-emerald-300" : "text-amber-300")
                }
              >
                {currentLevelCopy}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Fecha</p>
              <strong className="mt-1 block text-sm text-white">
                {formatDate(result.evaluation_date, studio.timezone)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      {result.criteria.length ? (
        <section>
          <div className="mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              Desglose técnico
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Tu evaluación</h2>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            {result.criteria.map((criterion) => (
              <div
                key={criterion.label}
                className="grid grid-cols-[1fr_auto] gap-4 border-t border-white/[0.06] px-4 py-4 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-white">{criterion.label}</strong>
                    <span className="text-[10px] text-zinc-600">
                      {percent(criterion.weight_percent)} del resultado
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={
                        "h-full rounded-full " +
                        (criterion.passed ? "bg-fuchsia-500" : "bg-amber-400")
                      }
                      style={{
                        width:
                          Math.max(0, Math.min(100, Number(criterion.score_percent ?? 0))) + "%",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-500">
                    Mínimo requerido: {percent(criterion.min_percent)}
                  </p>
                </div>
                <div className="text-right">
                  <strong className="text-lg text-white">{percent(criterion.score_percent)}</strong>
                  <span
                    className={
                      "mt-1 block text-[10px] font-semibold " +
                      (criterion.passed ? "text-emerald-300" : "text-amber-300")
                    }
                  >
                    {criterion.passed ? "Cumple" : "Por mejorar"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        {result.strengths?.length ? (
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Fortalezas
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.strengths.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-xs text-emerald-100"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {result.improvement_areas?.length ? (
          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.05] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
              Áreas por mejorar
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.improvement_areas.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-xs text-amber-100"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {result.coach_message ? (
          <div className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              Mensaje de tu coach
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-200">{result.coach_message}</p>
          </div>
        ) : null}

        {result.next_objective ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Próximo objetivo
            </p>
            <strong className="mt-2 block text-base text-white">{result.next_objective}</strong>
          </div>
        ) : null}
      </section>

      {result.next_due_on ? (
        <section className="rounded-3xl border border-violet-400/20 bg-violet-400/[0.05] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
            Siguiente evaluación
          </p>
          <strong className="mt-2 block text-lg text-white">
            {formatDate(result.next_due_on, studio.timezone)}
          </strong>
          {result.cadence_months ? (
            <p className="mt-1 text-xs text-zinc-500">
              Tu ciclo continúa cada {result.cadence_months} meses desde esta evaluación.
            </p>
          ) : null}
        </section>
      ) : null}

      <Link
        href="/student/evaluaciones"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
      >
        Volver a mis evaluaciones
      </Link>
    </main>
  );
}
