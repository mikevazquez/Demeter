import Link from "next/link";

import {
  bookingReasonCopy,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

function safeDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateChip(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" }).format(date),
    day: new Intl.DateTimeFormat("es-MX", { day: "numeric", timeZone: "UTC" }).format(date),
  };
}

export default async function StudentReservePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; discipline?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, snapshot, studio, membership } = await getStudentPortalContext();
  const today = localDateKey(new Date(), studio.timezone);
  const selectedDate = safeDate(query.date, today);
  const disciplineId = query.discipline?.trim() || null;

  const [{ data: sessions, error }, { data: disciplines }] = await Promise.all([
    supabase.rpc("student_schedule_feed", {
      target_start: selectedDate,
      target_end: selectedDate,
      target_discipline_id: disciplineId,
    }),
    supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", membership.studio_id)
      .eq("active", true)
      .order("name"),
  ]);

  const items = (sessions ?? []) as StudentSession[];
  const days = Array.from({ length: 7 }, (_, index) => addDays(selectedDate, index));
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Reservar</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Elige tu próxima clase
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          La disponibilidad y tus condiciones de reserva se validan en tiempo real.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {days.map((day) => {
            const chip = dateChip(day);
            const href = `/student/reservar?date=${day}${disciplineId ? `&discipline=${encodeURIComponent(disciplineId)}` : ""}`;
            return (
              <Link
                key={day}
                href={href}
                className={`min-w-16 rounded-2xl px-3 py-3 text-center transition ${
                  day === selectedDate
                    ? "bg-fuchsia-600 text-white"
                    : "border border-white/10 bg-black/20 text-zinc-400 hover:text-white"
                }`}
              >
                <span className="block text-xs capitalize">{chip.weekday}</span>
                <strong className="mt-1 block text-lg">{chip.day}</strong>
              </Link>
            );
          })}
        </div>

        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]" method="get">
          <input type="hidden" name="date" value={selectedDate} />
          <label className="text-sm text-zinc-300">
            Disciplina
            <select
              name="discipline"
              defaultValue={disciplineId ?? ""}
              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white"
            >
              <option value="">Todas las disciplinas</option>
              {(disciplines ?? []).map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="self-end rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.05]"
          >
            Aplicar filtro
          </button>
        </form>
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
        {items.length ? (
          items.map((session) => {
            const eligible = Boolean(session.eligibility?.eligible);
            const reserved = Boolean(session.is_reserved);
            return (
              <Link
                key={session.session_id}
                href={`/student/reservar/${session.session_id}`}
                className="block rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30 hover:bg-white/[0.05]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                      {session.discipline}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-white">{session.activity}</h2>
                    <p className="mt-2 text-sm text-zinc-400">
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
                        ? "Ya reservada"
                        : bookingReasonCopy(session.eligibility?.reason_code)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
            <h2 className="font-semibold text-white">Sin clases disponibles</h2>
            <p className="mt-2 text-sm text-zinc-400">
              No encontramos sesiones para esta fecha y filtro. Prueba otro día o disciplina.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
