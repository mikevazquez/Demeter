import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import {
  addDays,
  formatLongDate,
  formatTime,
  isDateKey,
  localDateKey,
  type CoachSession,
} from "@/lib/coach/portal";

function statusLabel(status: CoachSession["session_status"]) {
  if (status === "completed") return "Finalizada";
  if (status === "cancelled") return "Cancelada";
  return "Programada";
}

export default async function CoachHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.SCHEDULE_READ);
  const today = localDateKey(new Date(), studio.timezone);
  const tomorrow = addDays(today, 1);
  const selectedDate = isDateKey(query.date) ? query.date! : today;
  const { data, error: feedError } = await supabase.rpc("coach_my_sessions", {
    target_studio_id: studio.id,
    target_start: selectedDate,
    target_end: selectedDate,
  });
  const sessions = (data ?? []) as CoachSession[];

  return (
    <main className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-300">Coach</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Mis clases</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Consulta únicamente las clases que tienes asignadas y abre cada sesión para gestionar su
          asistencia.
        </p>
      </section>

      {query.error === "access" ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          No tienes permiso para realizar esa acción desde el portal Coach.
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Agenda asignada
            </p>
            <h2 className="mt-1 text-xl font-semibold capitalize text-white">
              {formatLongDate(selectedDate)}
            </h2>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/coach"
                className={`rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                  selectedDate === today
                    ? "bg-fuchsia-600 text-white"
                    : "border border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                }`}
              >
                Hoy
              </Link>
              <Link
                href={`/coach?date=${tomorrow}`}
                className={`rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                  selectedDate === tomorrow
                    ? "bg-fuchsia-600 text-white"
                    : "border border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                }`}
              >
                Mañana
              </Link>
            </div>

            <form className="flex gap-2" action="/coach" method="get">
              <label className="sr-only" htmlFor="coach-date">
                Elegir fecha
              </label>
              <input
                id="coach-date"
                name="date"
                type="date"
                defaultValue={selectedDate}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white [color-scheme:dark]"
              />
              <button
                type="submit"
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.05]"
              >
                Ir
              </button>
            </form>
          </div>
        </div>
      </section>

      {feedError ? (
        <section className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.08] p-5 text-sm text-rose-100">
          No pudimos cargar tus clases. Intenta de nuevo; si continúa, revisaremos el acceso del
          instructor.
        </section>
      ) : sessions.length ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => {
            const occupied = Number(session.reserved_count);
            const full = occupied >= session.capacity;

            return (
              <article
                key={session.session_id}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                      {formatTime(session.starts_at, studio.timezone)} –{" "}
                      {formatTime(session.ends_at, studio.timezone)}
                    </p>
                    <h3 className="mt-2 truncate text-xl font-semibold text-white">
                      {session.template_name}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      {session.space_name ?? "Espacio por confirmar"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-zinc-300">
                    {statusLabel(session.session_status)}
                  </span>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-black/20 px-4 py-3">
                  <div>
                    <p className="text-xs text-zinc-500">Ocupación</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {occupied} / {session.capacity}
                    </p>
                  </div>
                  {full ? (
                    <span className="rounded-full bg-fuchsia-500/15 px-3 py-1 text-xs font-semibold text-fuchsia-200">
                      Clase llena
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      {session.capacity - occupied} lugares disponibles
                    </span>
                  )}
                </div>

                <Link
                  href={`/coach/clases/${session.session_id}`}
                  className="mt-5 block rounded-xl bg-fuchsia-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                >
                  Abrir clase
                </Link>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-lg font-semibold text-white">No tienes clases asignadas este día</p>
          <p className="mt-2 text-sm text-zinc-500">Elige otra fecha para revisar tu agenda.</p>
        </section>
      )}
    </main>
  );
}
