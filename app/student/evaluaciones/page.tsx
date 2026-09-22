import Link from "next/link";

import { formatDate, formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

type EvaluationDisciplineSnapshot = {
  discipline_id: string;
  discipline_name: string;
  discipline_level_id: string;
  current_level_title: string;
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

function outcomeLabel(value: string | null) {
  if (value === "approved") return "Aprobada";
  if (value === "stays") return "Permanece";
  return "Incompleta";
}

function outcomeTone(value: string | null) {
  if (value === "approved") {
    return "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-300";
  }
  if (value === "stays") {
    return "border-amber-400/35 bg-amber-400/[0.08] text-amber-300";
  }
  return "border-zinc-600 bg-white/[0.03] text-zinc-400";
}

function statusCopy(status: EvaluationDisciplineSnapshot["invitation_status"]) {
  const labels: Record<string, string> = {
    offered: "Evaluación disponible",
    pending_schedule: "Pendiente de programar",
    scheduled: "Programada",
    in_progress: "Evaluación en curso",
  };
  return status ? (labels[status] ?? status) : "";
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
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            Mi progreso
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Evaluaciones
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Tu progreso técnico, disciplina por disciplina.
          </p>
        </div>

        <Link
          href="/student/perfil"
          aria-label="Cerrar evaluaciones"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-xl text-zinc-300 transition hover:border-fuchsia-500/40 hover:bg-fuchsia-500/[0.08] hover:text-white"
        >
          ×
        </Link>
      </header>

      <section className="space-y-3" aria-label="Estado de evaluaciones">
        {cards.length ? (
          cards.map((item) => (
            <article
              key={item.discipline_id}
              className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.12),transparent_34%),rgba(255,255,255,0.025)] p-5"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500"
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{item.discipline_name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Nivel actual:{" "}
                    <strong className="text-zinc-200">{item.current_level_title}</strong>
                  </p>
                </div>

                {item.invitation_status ? (
                  <span className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/[0.08] px-3 py-1 text-[10px] font-semibold text-fuchsia-300">
                    {statusCopy(item.invitation_status)}
                  </span>
                ) : item.cycle_id ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-3 py-1 text-[10px] font-semibold text-emerald-300">
                    Ciclo activo
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold text-zinc-500">
                    Sin evaluaciones
                  </span>
                )}
              </div>

              {item.invitation_status === "offered" && item.invitation_id ? (
                <div className="mt-5 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-4">
                  <p className="text-sm font-semibold text-white">Tu evaluación está disponible</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    Puedes aceptarla y elegir una clase entre el{" "}
                    {item.window_start ? formatDate(item.window_start, studio.timezone) : "—"} y el{" "}
                    {item.window_end ? formatDate(item.window_end, studio.timezone) : "—"}.
                  </p>
                  <Link
                    href={"/student/evaluaciones/" + item.invitation_id}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Ver invitación
                  </Link>
                </div>
              ) : item.invitation_status === "pending_schedule" && item.invitation_id ? (
                <div className="mt-5">
                  <p className="text-xs text-zinc-400">
                    Disponible para programar del{" "}
                    {item.window_start ? formatDate(item.window_start, studio.timezone) : "—"} al{" "}
                    {item.window_end ? formatDate(item.window_end, studio.timezone) : "—"}.
                  </p>
                  <Link
                    href={"/student/evaluaciones/" + item.invitation_id + "/programar"}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Programar evaluación
                  </Link>
                </div>
              ) : item.invitation_status === "scheduled" && item.scheduled_starts_at ? (
                <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-400/[0.06] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                    Próxima evaluación
                  </p>
                  <strong className="mt-1 block text-sm text-white">
                    {formatDateTime(item.scheduled_starts_at, studio.timezone)}
                  </strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    Tu reserva sigue las mismas políticas de cualquier clase.
                  </p>
                </div>
              ) : item.invitation_status === "in_progress" ? (
                <div className="mt-5 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-4">
                  <p className="text-sm font-semibold text-white">Evaluación en curso</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Tu coach está registrando la evaluación. El resultado aparecerá cuando esté
                    finalizada.
                  </p>
                </div>
              ) : item.next_due_on ? (
                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Siguiente evaluación
                    </p>
                    <strong className="mt-1 block text-sm text-white">
                      {formatDate(item.next_due_on, studio.timezone)}
                    </strong>
                  </div>
                  {item.cadence_months ? (
                    <span className="text-xs text-zinc-500">Cada {item.cadence_months} meses</span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-zinc-500">
                  {item.latest_evaluation_id
                    ? "Aquí aparecerá tu siguiente evaluación cuando corresponda."
                    : "Aún no formas parte del ciclo de evaluaciones de esta disciplina."}
                </p>
              )}

              {item.latest_evaluation_id && !item.invitation_status ? (
                <Link
                  href={"/student/evaluaciones/resultado/" + item.latest_evaluation_id}
                  className="mt-4 flex min-h-12 items-center justify-between rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                >
                  <span>Ver resultado de tu evaluación</span>
                  <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 text-center">
            <p className="text-sm font-semibold text-white">Aún no hay disciplinas evaluables</p>
            <p className="mt-1 text-xs text-zinc-500">
              El estudio todavía no ha habilitado niveles técnicos para tu cuenta.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              Historial
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Evaluaciones realizadas</h2>
          </div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-zinc-500">
            {history.length}
          </span>
        </div>

        {history.length ? (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            {history.map((evaluation) => (
              <Link
                key={evaluation.id}
                href={"/student/evaluaciones/resultado/" + evaluation.id}
                className="grid min-h-16 grid-cols-[82px_1fr_auto_auto] items-center gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0"
              >
                <span className="text-xs text-zinc-500">
                  {formatDate(evaluation.evaluation_date, studio.timezone)}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-white">
                    {evaluation.discipline_name}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {evaluation.evaluated_level_title ?? "Nivel técnico"}
                  </span>
                </span>
                <span
                  className={
                    "rounded-full border px-2.5 py-1 text-[10px] font-semibold " +
                    outcomeTone(evaluation.final_outcome)
                  }
                >
                  {outcomeLabel(evaluation.final_outcome)}
                </span>
                <strong className="text-sm text-white">{evaluation.total_score ?? "—"}%</strong>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 text-center">
            <p className="text-sm font-semibold text-white">Aún no hay evaluaciones</p>
            <p className="mt-1 text-xs text-zinc-500">
              Cuando completes una evaluación, tu resultado aparecerá aquí.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
