import Link from "next/link";

import { formatDate, formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentHomePage() {
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Hola, {snapshot.profile.first_name}</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Tu estudio, en un solo lugar
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Revisa tu paquete, próximas clases y actividad.
        </p>
      </header>

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/15 via-white/[0.04] to-transparent p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
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
          <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-right">
            <strong className="block text-4xl font-semibold text-white">
              {activePackage?.unlimited ? "∞" : (activePackage?.available_credits ?? 0)}
            </strong>
            <span className="text-xs text-zinc-400">
              {activePackage?.unlimited ? "acceso ilimitado" : "clases disponibles"}
            </span>
          </div>
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
                <Link
                  key={item.reservation_id}
                  href={`/student/reservar/${item.session_id}`}
                  className="block rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:border-fuchsia-500/30"
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
                </Link>
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
