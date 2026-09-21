import Link from "next/link";

import { formatDate, formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

function outcomeLabel(value: string | null) {
  if (value === "approved") return "Aprobada";
  if (value === "stays") return "Permanece";
  return "Incompleta";
}

function outcomeTone(value: string | null) {
  if (value === "approved") return "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-300";
  if (value === "stays") return "border-amber-400/35 bg-amber-400/[0.08] text-amber-300";
  return "border-zinc-600 bg-white/[0.03] text-zinc-400";
}

function statusCopy(status: string) {
  const labels: Record<string, string> = {
    offered: "Evaluación disponible",
    pending_schedule: "Pendiente de programar",
    scheduled: "Programada",
    in_progress: "Evaluación en curso",
  };
  return labels[status] ?? status;
}

export default async function StudentEvaluationsPage() {
  const { supabase, snapshot, studio } = await getStudentPortalContext();
  const studentId = snapshot.profile.student_id;
  const studioId = snapshot.profile.studio_id;

  const [
    disciplinesResult,
    linksResult,
    definitionsResult,
    levelsResult,
    cyclesResult,
    invitationsResult,
    evaluationsResult,
  ] = await Promise.all([
    supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", studioId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("discipline_technical_levels")
      .select("id,discipline_id,technical_level_id,discipline_order,active")
      .eq("studio_id", studioId)
      .eq("active", true)
      .order("discipline_order"),
    supabase
      .from("technical_level_definitions")
      .select("id,title")
      .eq("studio_id", studioId)
      .eq("active", true),
    supabase
      .from("student_discipline_levels")
      .select("discipline_id,discipline_technical_level_id")
      .eq("studio_id", studioId)
      .eq("student_id", studentId),
    supabase
      .from("student_evaluation_cycles")
      .select("id,discipline_id,active,cadence_months,next_due_on")
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .eq("active", true),
    supabase
      .from("evaluation_invitations")
      .select(
        "id,discipline_id,discipline_level_id,invitation_kind,status,window_start,window_end,reservation_id,offered_at,scheduled_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("technical_evaluations")
      .select(
        "id,discipline_id,target_discipline_level_id,resulting_discipline_level_id,evaluation_date,status,total_score,final_outcome,published_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .eq("status", "published")
      .order("evaluation_date", { ascending: false }),
  ]);

  const disciplines = disciplinesResult.data ?? [];
  const links = linksResult.data ?? [];
  const definitions = definitionsResult.data ?? [];
  const levels = levelsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const invitations = invitationsResult.data ?? [];
  const evaluations = evaluationsResult.data ?? [];

  const definitionTitle = new Map(definitions.map((item) => [item.id, item.title]));
  const levelTitle = new Map(
    links.map((item) => [
      item.id,
      definitionTitle.get(item.technical_level_id) ?? "Nivel técnico",
    ]),
  );
  const openStatuses = new Set(["offered", "pending_schedule", "scheduled", "in_progress"]);

  const reservationIds = invitations
    .map((item) => item.reservation_id)
    .filter((value): value is string => Boolean(value));
  const reservationsResult = reservationIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,status")
        .in("id", reservationIds)
    : { data: [] };
  const reservationMap = new Map((reservationsResult.data ?? []).map((item) => [item.id, item]));

  const sessionIds = [...new Set((reservationsResult.data ?? []).map((item) => item.session_id))];
  const sessionsResult = sessionIds.length
    ? await supabase
        .from("class_sessions")
        .select("id,starts_at")
        .in("id", sessionIds)
    : { data: [] };
  const sessionMap = new Map((sessionsResult.data ?? []).map((item) => [item.id, item]));

  const cards = disciplines
    .map((discipline) => {
      const disciplineLinks = links.filter((item) => item.discipline_id === discipline.id);
      if (!disciplineLinks.length) return null;

      const current = levels.find((item) => item.discipline_id === discipline.id);
      const currentLevelId = current?.discipline_technical_level_id ?? disciplineLinks[0]?.id ?? null;
      const invitation = invitations.find(
        (item) => item.discipline_id === discipline.id && openStatuses.has(item.status),
      );
      const cycle = cycles.find((item) => item.discipline_id === discipline.id);
      const lastResult = evaluations.find((item) => item.discipline_id === discipline.id);

      const reservation = invitation?.reservation_id
        ? reservationMap.get(invitation.reservation_id)
        : null;
      const session = reservation ? sessionMap.get(reservation.session_id) : null;

      return {
        discipline,
        currentLevelId,
        currentLevel: currentLevelId ? levelTitle.get(currentLevelId) ?? "Principiante" : "Principiante",
        invitation,
        cycle,
        lastResult,
        session,
      };
    })
    .filter(Boolean);

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Mi progreso
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Evaluaciones
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Tu progreso técnico, disciplina por disciplina.
        </p>
      </header>

      <section className="space-y-3" aria-label="Estado de evaluaciones">
        {cards.map((item) => {
          if (!item) return null;
          const { discipline, invitation, cycle, lastResult, session } = item;

          return (
            <article
              key={discipline.id}
              className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.12),transparent_34%),rgba(255,255,255,0.025)] p-5"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500"
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{discipline.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Nivel actual: <strong className="text-zinc-200">{item.currentLevel}</strong>
                  </p>
                </div>
                {invitation ? (
                  <span className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/[0.08] px-3 py-1 text-[10px] font-semibold text-fuchsia-300">
                    {statusCopy(invitation.status)}
                  </span>
                ) : cycle ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-3 py-1 text-[10px] font-semibold text-emerald-300">
                    Ciclo activo
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold text-zinc-500">
                    Sin evaluaciones
                  </span>
                )}
              </div>

              {invitation?.status === "offered" ? (
                <div className="mt-5 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-4">
                  <p className="text-sm font-semibold text-white">Tu evaluación está disponible</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    Puedes aceptarla y elegir una clase entre el{" "}
                    {formatDate(invitation.window_start, studio.timezone)} y el{" "}
                    {formatDate(invitation.window_end, studio.timezone)}.
                  </p>
                  <Link
                    href={`/student/evaluaciones/${invitation.id}`}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Ver invitación
                  </Link>
                </div>
              ) : invitation?.status === "pending_schedule" ? (
                <div className="mt-5">
                  <p className="text-xs text-zinc-400">
                    Disponible para programar del{" "}
                    {formatDate(invitation.window_start, studio.timezone)} al{" "}
                    {formatDate(invitation.window_end, studio.timezone)}.
                  </p>
                  <Link
                    href={`/student/evaluaciones/${invitation.id}/programar`}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Programar evaluación
                  </Link>
                </div>
              ) : invitation?.status === "scheduled" && session ? (
                <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-400/[0.06] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                    Próxima evaluación
                  </p>
                  <strong className="mt-1 block text-sm text-white">
                    {formatDateTime(session.starts_at, studio.timezone)}
                  </strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    Tu reserva sigue las mismas políticas de cualquier clase.
                  </p>
                </div>
              ) : invitation?.status === "in_progress" ? (
                <div className="mt-5 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-4">
                  <p className="text-sm font-semibold text-white">Evaluación en curso</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Tu coach está registrando la evaluación. El resultado aparecerá cuando esté finalizada.
                  </p>
                </div>
              ) : cycle?.next_due_on ? (
                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Siguiente evaluación
                    </p>
                    <strong className="mt-1 block text-sm text-white">
                      {formatDate(cycle.next_due_on, studio.timezone)}
                    </strong>
                  </div>
                  <span className="text-xs text-zinc-500">Cada {cycle.cadence_months} meses</span>
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-zinc-500">
                  {lastResult
                    ? "Aquí aparecerá tu siguiente evaluación cuando corresponda."
                    : "Aún no formas parte del ciclo de evaluaciones de esta disciplina."}
                </p>
              )}

              {lastResult && !invitation ? (
                <Link
                  href={`/student/evaluaciones/resultado/${lastResult.id}`}
                  className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-zinc-300"
                >
                  <span>
                    Última evaluación · {outcomeLabel(lastResult.final_outcome)}
                  </span>
                  <span aria-hidden="true" className="text-fuchsia-300">
                    ›
                  </span>
                </Link>
              ) : null}
            </article>
          );
        })}
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
            {evaluations.length}
          </span>
        </div>

        {evaluations.length ? (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            {evaluations.map((evaluation) => {
              const discipline = disciplines.find((item) => item.id === evaluation.discipline_id);
              return (
                <Link
                  key={evaluation.id}
                  href={`/student/evaluaciones/resultado/${evaluation.id}`}
                  className="grid min-h-16 grid-cols-[82px_1fr_auto_auto] items-center gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0"
                >
                  <span className="text-xs text-zinc-500">
                    {formatDate(evaluation.evaluation_date, studio.timezone)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-white">
                      {discipline?.name ?? "Disciplina"}
                    </strong>
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      {levelTitle.get(evaluation.target_discipline_level_id) ?? "Nivel técnico"}
                    </span>
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${outcomeTone(
                      evaluation.final_outcome,
                    )}`}
                  >
                    {outcomeLabel(evaluation.final_outcome)}
                  </span>
                  <strong className="text-sm text-white">{evaluation.total_score ?? "—"}%</strong>
                </Link>
              );
            })}
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
