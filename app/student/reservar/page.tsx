import Link from "next/link";

import {
  bookingReasonCopy,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import { QuickBookButton } from "./quick-book-button";

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

export default async function StudentReservePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, snapshot, studio } = await getStudentPortalContext();
  const today = localDateKey(new Date(), studio.timezone);
  const requestedDate = safeDate(query.date, today);
  const selectedDate = requestedDate < today ? today : requestedDate;
  const weekStart = startOfWeek(selectedDate);
  const currentWeekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const previousWeekDate = addDays(selectedDate, -7);
  const nextWeekDate = addDays(selectedDate, 7);

  const { data: sessions, error } = await supabase.rpc("student_schedule_feed", {
    target_start: selectedDate,
    target_end: selectedDate,
    target_discipline_id: null,
  });

  const items = (sessions ?? []) as StudentSession[];
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Reservar</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Elige tu próxima clase
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Elige un día y reserva directamente desde la clase. La disponibilidad y tu paquete se
          validan en tiempo real.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          {weekStart > currentWeekStart ? (
            <Link
              href={`/student/reservar?date=${previousWeekDate < today ? today : previousWeekDate}`}
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

          <p className="text-center text-sm font-medium text-zinc-300">
            {shortDate(weekStart)} – {shortDate(weekEnd)}
          </p>

          <Link
            href={`/student/reservar?date=${nextWeekDate}`}
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
              <Link key={day} href={`/student/reservar?date=${day}`} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      {query.error || error ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          No pudimos cargar la agenda. Intenta de nuevo.
        </div>
      ) : null}

      {!activePackage ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100">
          No tienes un paquete activo. Puedes explorar las clases, pero Studio Flow te indicará qué
          necesitas antes de reservar.
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Clases del día
          </p>
          <h2 className="mt-1 text-xl font-semibold capitalize text-white">
            {longDate(selectedDate)}
          </h2>
        </div>

        {items.length ? (
          items.map((session) => {
            const eligible = Boolean(session.eligibility?.eligible);
            const reserved = Boolean(session.is_reserved);
            const timeLabel = formatDateTime(session.starts_at, studio.timezone);

            return (
              <article
                key={session.session_id}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30 hover:bg-white/[0.05]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                      {session.discipline}
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-white">{session.activity}</h3>
                    <p className="mt-2 text-sm text-zinc-400">{timeLabel}</p>
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
                        ? "Ya reservada"
                        : bookingReasonCopy(session.eligibility?.reason_code)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <Link
                    href={`/student/reservar/${session.session_id}`}
                    className="min-h-11 rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    Ver detalles
                  </Link>

                  <QuickBookButton
                    sessionId={session.session_id}
                    activity={session.activity}
                    discipline={session.discipline}
                    timeLabel={timeLabel}
                    eligible={eligible}
                    reserved={reserved}
                  />
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
            <h3 className="font-semibold text-white">Sin clases disponibles</h3>
            <p className="mt-2 text-sm text-zinc-400">
              No encontramos sesiones para este día. Elige otro día de la semana.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
