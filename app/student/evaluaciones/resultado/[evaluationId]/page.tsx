import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

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
  const progression = result.evaluation_purpose === "progression";
  const confirmedLevel =
    placement && !approved
      ? "Sin nivel confirmado"
      : (result.resulting_level_title ?? result.evaluated_level_title);
  const levelCardLabel = approved
    ? placement
      ? "Nivel confirmado"
      : progression
        ? "Nuevo nivel"
        : "Nivel confirmado"
    : placement
      ? "Nivel actual"
      : "Nivel actual";
  const headline = approved
    ? "¡Evaluación aprobada!"
    : placement
      ? "Nivel todavía no confirmado"
      : "Continúas en tu nivel";
  const subheadline = approved
    ? "Tu esfuerzo dio resultados."
    : placement
      ? "Esta evaluación aún no confirmó un nivel técnico."
      : "Estás construyendo bases sólidas.";

  return (
    <main className="mx-auto max-w-3xl space-y-3 pb-4">
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

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_85%_0%,rgba(236,72,153,0.14),transparent_32%),linear-gradient(150deg,#131018,#0b1017)] p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[150px_1fr] sm:items-stretch">
          <div className="relative min-h-40 overflow-hidden rounded-[22px] border border-fuchsia-500/40 bg-[radial-gradient(circle_at_50%_20%,rgba(236,72,153,0.34),transparent_26%),linear-gradient(145deg,#2a0a1d,#090c12_72%)] shadow-[0_0_28px_rgba(236,72,153,0.14)]">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_35%,rgba(236,72,153,0.14),transparent_70%)]" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                {result.discipline_name}
              </span>
              <strong className="mt-1 block text-lg text-white">
                {result.evaluated_level_title}
              </strong>
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-center">
            <span
              className={
                "inline-flex w-fit rounded-xl border px-3 py-1.5 text-[10px] font-semibold " +
                (approved
                  ? "border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/[0.08] text-amber-300")
              }
            >
              {approved ? "✓ Evaluación completada" : "− Evaluación completada"}
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{headline}</h1>
            <p className="mt-1 text-sm text-zinc-400">{subheadline}</p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <div>
                <strong className="text-lg text-white">{result.discipline_name}</strong>
                <p className="text-xs text-zinc-400">
                  Nivel evaluado: {result.evaluated_level_title}
                </p>
              </div>
              <span aria-hidden="true" className="text-xl text-zinc-500">
                ›
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className={
          "rounded-[24px] border p-4 " +
          (approved
            ? "border-fuchsia-500/45 bg-fuchsia-500/[0.055]"
            : "border-fuchsia-500/35 bg-white/[0.02]")
        }
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-zinc-400">{levelCardLabel}</p>
            <strong className="mt-1 block text-2xl font-semibold text-fuchsia-400">
              {confirmedLevel}
            </strong>
          </div>
          <span
            aria-hidden="true"
            className="grid h-11 w-11 place-items-center rounded-2xl bg-fuchsia-500/[0.12] text-2xl text-fuchsia-400"
          >
            {approved ? "↗" : "="}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-2 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.025]">
        <div className="border-r border-white/[0.06] p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Fecha de evaluación
          </p>
          <strong className="mt-1 block text-base text-white">
            {formatDate(result.evaluation_date, studio.timezone)}
          </strong>
        </div>
        <div className="p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Puntuación total</p>
          <strong className="mt-1 block text-base text-white">{percent(result.total_score)}</strong>
        </div>
      </section>

      {result.criteria.length ? (
        <section className="rounded-[24px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_90%_0%,rgba(236,72,153,0.08),transparent_36%),rgba(255,255,255,0.02)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                Desglose de puntaje
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">Tu evaluación</h2>
            </div>
            <span className="text-xs font-semibold text-fuchsia-300">Detalle</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {result.criteria.map((criterion) => (
              <div
                key={criterion.label}
                className="rounded-2xl border border-white/[0.07] bg-black/15 p-3 text-center"
              >
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-[5px] border-fuchsia-500/80 bg-[#0b1016] text-sm font-semibold text-white">
                  {percent(criterion.score_percent)}
                </div>
                <strong className="mt-3 block text-xs text-white">{criterion.label}</strong>
                <span className="mt-1 block text-[10px] text-zinc-500">
                  {percent(criterion.weight_percent)} del resultado
                </span>
              </div>
            ))}
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
                {formatDate(result.next_due_on, studio.timezone)}
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

      <section className="rounded-[24px] border border-fuchsia-500/25 bg-fuchsia-500/[0.03] p-4">
        <p className="text-sm font-semibold text-white">
          {approved
            ? "Disciplina hoy, más movimiento mañana."
            : "El progreso también se mide en constancia."}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {approved
            ? "Sigue explorando tu potencial."
            : "Sigue entrenando, vas construyendo tu camino."}
        </p>
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
