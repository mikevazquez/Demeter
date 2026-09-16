import Link from "next/link";

import {
  bookingReasonCopy,
  formatDate,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import { cancelStudentReservationAction } from "./actions";

function safeDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const distanceToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + distanceToMonday);
  return date.toISOString().slice(0, 10);
}

function dateChip(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" }).format(date),
    day: new Intl.DateTimeFormat("es-MX", { day: "numeric", timeZone: "UTC" }).format(date),
  };
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; cancelled?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, snapshot, studio } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const today = localDateKey(new Date(), studio.timezone);
  const requestedDate = safeDate(query.date, today);
  const selectedDate = requestedDate < today ? today : requestedDate;
  const weekStart = startOfWeek(selectedDate);
  const currentWeekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const previousWeekDate = addDays(selectedDate, -7);
  const nextWeekDate = addDays(selectedDate, 7);

  const { data: sessions, error: scheduleError } = await supabase.rpc("student_schedule_feed", {
    target_start: selectedDate,
    target_end: selectedDate,
    target_discipline_id: null,
  });
  const daySessions = (sessions ?? []) as StudentSession[];

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Hola, {snapshot.profile.first_name}</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Tu estudio, en un solo lugar
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Revisa tu paquete, las clases del día y tu actividad.
        </p>
      </header>

      {query.cancelled ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-200">
          ✓ Tu reserva se canceló correctamente.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          No pudimos completar la cancelación. Revisa la clase e intenta de nuevo.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/15 via-white/[0.04] to-transparent p-5 sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
            Tu paquete activo
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {activePackage?.name ?? "Sin paquete activo"}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {activePackage
              ? `Vigente hasta ${formatDate(activePackage.expires_on, studio.timezone)}`
              : "Cuando tengas un paquete vigente aparecerá aquí."}
          </p>
        </div>

        {activePackage ? (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-black/20 p-3">
              <p className="text-xs text-zinc-500">Disponibles</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {activePackage.unlimited ? "∞" : activePackage.available_credits}
              </p>
            </div>
            <div className="rounded-2xl bg-black/20 p-3">
              <p className="text-xs text-zinc-500">Reservadas</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {activePackage.reserved_credits}
              </p>
            </div>
            <div className="rounded-2xl bg-black/20 p-3">
              <p className="text-xs text-zinc-500">Utilizadas</p>
              <p className="mt-1 text-lg font-semibold text-white">{activePackage.used_credits}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/student/reservar"
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Reservar clase
          </Link>
          <Link
            href="/student/paquete"
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.05]"
          >
            Ver mi paquete
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          {weekStart > currentWeekStart ? (
            <Link
              href={`/student?date=${previousWeekDate < today ? today : previousWeekDate}`}
              aria-label="Semana anterior"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xl text-white transition hover:bg-white/[0.06]"
            >
              ‹
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/5 text-xl text-zinc-700"
            >
              ‹
            </span>
          )}

          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Clases del día
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-300">
              {shortDate(weekStart)} – {shortDate(weekEnd)}
            </p>
          </div>

          <Link
            href={`/student?date=${nextWeekDate}`}
            aria-label="Semana siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xl text-white transition hover:bg-white/[0.06]"
          >
            ›
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {days.map((day) => {
            const chip = dateChip(day);
            const isPast = day < today;
            const isSelected = day === selectedDate;
            const className = `rounded-2xl px-1 py-3 text-center transition ${
              isSelected
                ? "bg-fuchsia-600 text-white"
                : isPast
                  ? "border border-white/5 bg-black/10 text-zinc-700"
                  : "border border-white/10 bg-black/20 text-zinc-400 hover:text-white"
            }`;
            const content = (
              <>
                <span className="block text-[11px] capitalize sm:text-xs">{chip.weekday}</span>
                <strong className="mt-1 block text-base sm:text-lg">{chip.day}</strong>
              </>
            );

            return isPast ? (
              <span key={day} className={className} aria-disabled="true">
                {content}
              </span>
            ) : (
              <Link key={day} href={`/student?date=${day}`} className={className}>
                {content}
              </Link>
            );
          })}
        </div>

        <div className="mt-5">
          <h2 className="text-xl font-semibold capitalize text-white">{longDate(selectedDate)}</h2>
          {scheduleError ? (
            <p className="mt-3 text-sm text-rose-200">No pudimos cargar las clases del día.</p>
          ) : null}

          <div className="mt-4 space-y-3">
            {daySessions.length ? (
              daySessions.map((session) => {
                const reservation = snapshot.upcoming.find(
                  (item) => item.session_id === session.session_id,
                );
                const reserved = Boolean(reservation);
                const eligible = Boolean(session.eligibility?.eligible);

                return (
                  <article
                    key={session.session_id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                          {session.discipline}
                        </p>
                        <h3 className="mt-1 font-semibold text-white">{session.activity}</h3>
                        <p className="mt-1 text-sm text-zinc-400">
                          {formatDateTime(session.starts_at, studio.timezone)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {[session.coach, session.space || session.location]
                            .filter(Boolean)
                            .join(" · ") || "Detalles en la clase"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">
                          {session.spots_available}/{session.capacity} lugares
                        </p>
                        <span
                          className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
                            reserved
                              ? "bg-sky-500/15 text-sky-300"
                              : eligible
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-zinc-500/15 text-zinc-400"
                          }`}
                        >
                          {reserved
                            ? "Reservada"
                            : bookingReasonCopy(session.eligibility?.reason_code)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Link
                        href={`/student/reservar/${session.session_id}`}
                        className="text-sm font-semibold text-fuchsia-300"
                      >
                        Ver detalle
                      </Link>
                      {reservation ? (
                        <details className="group">
                          <summary className="cursor-pointer list-none text-sm font-semibold text-rose-300">
                            Cancelar
                          </summary>
                          <form
                            action={cancelStudentReservationAction}
                            className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3"
                          >
                            <input type="hidden" name="reservation_id" value={reservation.reservation_id} />
                            <input type="hidden" name="return_to" value="/student" />
                            <p className="text-xs leading-5 text-zinc-400">
                              Se aplicará la política vigente de cancelación al confirmar.
                            </p>
                            <button
                              type="submit"
                              className="mt-3 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200"
                            >
                              Confirmar cancelación
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-zinc-400">No hay clases disponibles para este día.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Próximas clases
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Tu agenda</h2>
            </div>
            <Link href="/student/mis-clases" className="text-sm font-semibold text-fuchsia-300">
              Ver todas
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {snapshot.upcoming.length ? (
              snapshot.upcoming.map((item) => (
                <article
                  key={item.reservation_id}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{item.activity}</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {formatDateTime(item.starts_at, studio.timezone)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {[item.coach, item.space].filter(Boolean).join(" · ") || item.discipline}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      Reservada
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/student/reservar/${item.session_id}`}
                      className="text-sm font-semibold text-fuchsia-300"
                    >
                      Ver clase
                    </Link>
                    <details>
                      <summary className="cursor-pointer list-none text-sm font-semibold text-rose-300">
                        Cancelar
                      </summary>
                      <form
                        action={cancelStudentReservationAction}
                        className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3"
                      >
                        <input type="hidden" name="reservation_id" value={item.reservation_id} />
                        <input type="hidden" name="return_to" value="/student" />
                        <p className="text-xs leading-5 text-zinc-400">
                          Se aplicará la política vigente de cancelación al confirmar.
                        </p>
                        <button
                          type="submit"
                          className="mt-3 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200"
                        >
                          Confirmar cancelación
                        </button>
                      </form>
                    </details>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-zinc-400">No tienes clases reservadas todavía.</p>
                <Link
                  href="/student/reservar"
                  className="mt-3 inline-block text-sm font-semibold text-fuchsia-300"
                >
                  Buscar una clase
                </Link>
              </div>
            )}
          </div>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Tu actividad
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Estadísticas</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-black/20 p-4">
              <strong className="text-2xl text-white">{snapshot.stats.attended_this_month}</strong>
              <p className="mt-1 text-xs text-zinc-500">este mes</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <strong className="text-2xl text-white">{snapshot.stats.streak_days}</strong>
              <p className="mt-1 text-xs text-zinc-500">días de racha</p>
            </div>
            <div className="col-span-2 rounded-2xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Clase más asistida</p>
              <strong className="mt-1 block text-lg text-white">
                {snapshot.stats.favorite_activity ?? "Aún sin datos"}
              </strong>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
