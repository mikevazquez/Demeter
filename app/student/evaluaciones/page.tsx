import Link from "next/link";

import { formatDate, formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

type EvaluationDisciplineSnapshot = {
  discipline_id: string;
  discipline_name: string;
  discipline_level_id: string | null;
  current_level_title: string | null;
  cycle_id: string | null;
  cadence_months: number | null;
  next_due_on: string | null;
  invitation_id: string | null;
  invitation_kind: "first" | "periodic" | null;
  invitation_status: "offered" | "pending_schedule" | "scheduled" | "in_progress" | null;
  window_start: string | null;
  window_end: string | null;
  reservation_id: string | null;
  scheduled_starts_at: string | null;
  latest_evaluation_id: string | null;
  latest_evaluation_date: string | null;
  latest_outcome: string | null;
  latest_score: number | null;
};

type EvaluationHistorySnapshot = {
  id: string;
  discipline_id: string;
  discipline_name: string;
  evaluated_level_title: string | null;
  resulting_level_title: string | null;
  evaluation_date: string;
  total_score: number | null;
  final_outcome: string | null;
  published_at: string | null;
};

type StudentEvaluationsSnapshot = {
  disciplines: EvaluationDisciplineSnapshot[];
  history: EvaluationHistorySnapshot[];
};

function evaluationState(item: EvaluationDisciplineSnapshot) {
  if (item.invitation_status === "offered" || item.invitation_status === "pending_schedule") {
    return {
      label: "Evaluación disponible",
      tone: "border-fuchsia-500/30 bg-fuchsia-500/[0.08] text-fuchsia-200",
    };
  }

  if (item.invitation_status === "scheduled" || item.invitation_status === "in_progress") {
    return {
      label: "Evaluación programada",
      tone: "border-cyan-400/30 bg-cyan-400/[0.07] text-cyan-200",
    };
  }

  if (item.current_level_title) {
    return {
      label: "Nivel confirmado",
      tone: "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200",
    };
  }

  return {
    label: "Aún sin nivel",
    tone: "border-white/10 bg-white/[0.03] text-zinc-400",
  };
}

function historyLabel(item: EvaluationHistorySnapshot) {
  const from = item.evaluated_level_title ?? null;
  const to = item.resulting_level_title ?? null;

  if (!from && to) return `Diagnóstico → ${to}`;
  if (from && to && from !== to) return `${from} → ${to}`;
  if (to) return `Nivel mantenido · ${to}`;
  if (from) return `Nivel mantenido · ${from}`;
  return "Evaluación completada";
}

export default async function StudentEvaluationsPage() {
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_evaluations_snapshot");

  if (error) {
    throw new Error(error.message);
  }

  const snapshot = (data ?? { disciplines: [], history: [] }) as StudentEvaluationsSnapshot;
  const cards = snapshot.disciplines ?? [];
  const history = snapshot.history ?? [];

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/perfil"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Perfil
        </Link>
        <p className="student-eyebrow mt-3">Mi entrenamiento</p>
        <h1 className="student-page-title mt-1">Nivel técnico</h1>
        <p className="student-body mt-2">
          Consulta tu nivel en cada disciplina y tus evaluaciones.
        </p>
      </header>

      <section className="space-y-3" aria-label="Nivel técnico por disciplina">
        {cards.length ? (
          cards.map((item) => {
            const state = evaluationState(item);

            return (
              <article key={item.discipline_id} className="student-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">{item.discipline_name}</h2>
                    <p className="mt-1 text-xl font-semibold text-cyan-200">
                      {item.current_level_title ?? "Aún sin nivel"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${state.tone}`}
                  >
                    {state.label}
                  </span>
                </div>

                {item.invitation_status === "offered" && item.invitation_id ? (
                  <div className="mt-4 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.045] p-4">
                    <h3 className="text-base font-semibold text-white">
                      {item.current_level_title
                        ? "Ya puedes realizar tu próxima evaluación"
                        : "Descubre tu nivel técnico"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      {item.window_start && item.window_end
                        ? `Puedes realizarla entre el ${formatDate(
                            item.window_start,
                            studio.timezone,
                          )} y el ${formatDate(item.window_end, studio.timezone)}.`
                        : "Tu evaluación está lista cuando tú quieras comenzar."}
                    </p>
                    <Link
                      href={"/student/evaluaciones/" + item.invitation_id}
                      className="student-action-primary mt-4 w-full sm:w-auto"
                    >
                      {item.current_level_title ? "Ver evaluación" : "Comenzar diagnóstico"}
                    </Link>
                  </div>
                ) : item.invitation_status === "pending_schedule" && item.invitation_id ? (
                  <div className="mt-4">
                    <p className="text-sm leading-6 text-zinc-400">
                      Elige una clase dentro del periodo disponible para realizar tu evaluación.
                    </p>
                    <Link
                      href={"/student/evaluaciones/" + item.invitation_id + "/programar"}
                      className="student-action-primary mt-4 w-full sm:w-auto"
                    >
                      Elegir mi clase
                    </Link>
                  </div>
                ) : item.invitation_status === "scheduled" && item.scheduled_starts_at ? (
                  <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
                    <p className="text-sm font-semibold text-cyan-100">Evaluación programada</p>
                    <p className="mt-1 text-sm text-zinc-300">
                      {formatDateTime(item.scheduled_starts_at, studio.timezone)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      Tu evaluación se realizará durante esta clase.
                    </p>
                  </div>
                ) : item.invitation_status === "in_progress" ? (
                  <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
                    <p className="text-sm font-semibold text-white">Evaluación en curso</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      Tu coach está registrando el resultado. Lo verás aquí cuando esté publicado.
                    </p>
                  </div>
                ) : item.next_due_on ? (
                  <p className="mt-4 text-sm text-zinc-400">
                    Próxima evaluación a partir del{" "}
                    <strong className="font-semibold text-white">
                      {formatDate(item.next_due_on, studio.timezone)}
                    </strong>
                  </p>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-zinc-500">
                    {item.current_level_title
                      ? "Te avisaremos cuando tu próxima evaluación esté disponible."
                      : "Te avisaremos cuando puedas realizar tu diagnóstico."}
                  </p>
                )}

                {item.latest_evaluation_id ? (
                  <Link
                    href={"/student/evaluaciones/resultado/" + item.latest_evaluation_id}
                    className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-fuchsia-300"
                  >
                    Ver último resultado →
                  </Link>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="student-card p-6 text-center">
            <p className="text-base font-semibold text-white">Aún no hay niveles técnicos</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Cuando Demeter habilite una disciplina para evaluación, aparecerá aquí.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2">
          <p className="student-eyebrow">Historial</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Evaluaciones realizadas</h2>
        </div>

        {history.length ? (
          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
            {history.map((evaluation) => (
              <Link
                key={evaluation.id}
                href={"/student/evaluaciones/resultado/" + evaluation.id}
                className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-white">
                    {evaluation.discipline_name}
                  </strong>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    {historyLabel(evaluation)}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-600">
                    {formatDate(evaluation.evaluation_date, studio.timezone)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xl text-zinc-600">
                  ›
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="student-card p-6 text-center">
            <p className="text-sm font-semibold text-white">Aún no hay evaluaciones realizadas</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Tus resultados aparecerán aquí después de tu primera evaluación.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
