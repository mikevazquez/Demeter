import Link from "next/link";

import {
  formatDate,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentAcquisition,
} from "@/lib/student/portal";

import StudentNoticeDialog from "./components/StudentNoticeDialog";

function dateDistanceInDays(from: string, to: string) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function availableCredits(activePackage: StudentAcquisition | null) {
  if (!activePackage || activePackage.unlimited) return null;
  return activePackage.available_credits ?? 0;
}

function creditLimit(activePackage: StudentAcquisition) {
  if (activePackage.credit_limit && activePackage.credit_limit > 0) {
    return activePackage.credit_limit;
  }

  return (
    (activePackage.available_credits ?? 0) +
    activePackage.reserved_credits +
    activePackage.used_credits
  );
}

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const credits = availableCredits(activePackage);
  const nextClass =
    [...snapshot.upcoming].sort(
      (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
    )[0] ?? null;

  const today = localDateKey(new Date(), studio.timezone);
  const daysUntilExpiration = activePackage
    ? dateDistanceInDays(today, activePackage.expires_on)
    : null;
  const expiresSoon =
    daysUntilExpiration !== null && daysUntilExpiration >= 0 && daysUntilExpiration <= 7;

  const packageLimit = activePackage ? creditLimit(activePackage) : 0;
  const usedProgress =
    activePackage && !activePackage.unlimited && packageLimit > 0
      ? Math.min(100, Math.round((activePackage.used_credits / packageLimit) * 100))
      : 0;

  const noCredits = Boolean(activePackage && !activePackage.unlimited && credits === 0);
  const canReserve = Boolean(activePackage && (activePackage.unlimited || (credits ?? 0) > 0));

  return (
    <main className="space-y-5 pb-4 sm:space-y-6">
      {query.cancelled ? (
        <StudentNoticeDialog
          eyebrow="Reserva actualizada"
          title="Tu reserva fue cancelada"
          dismissHref="/student"
        >
          La clase ya no aparece entre tus próximas reservas.
        </StudentNoticeDialog>
      ) : query.error ? (
        <StudentNoticeDialog
          eyebrow="No pudimos completar la acción"
          title="Revisa tu reserva"
          dismissHref="/student"
          tone="error"
        >
          No pudimos completar la cancelación. Revisa la clase e intenta nuevamente.
        </StudentNoticeDialog>
      ) : null}

      <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_78%_20%,rgba(236,72,153,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))] px-5 py-7 sm:px-7 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-[22%] top-0 w-px bg-gradient-to-b from-transparent via-fuchsia-500/70 to-transparent shadow-[0_0_28px_rgba(236,72,153,0.7)]"
        />
        <div className="relative max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">
            Demeter Fitness Studio
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Hola, {snapshot.profile.first_name} <span aria-hidden="true">♥</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Movimiento que transforma</p>
        </div>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
            Tu próxima clase
          </p>
          {nextClass ? (
            <Link href="/student/mis-clases" className="text-sm font-semibold text-fuchsia-300">
              Ver todas
            </Link>
          ) : null}
        </div>

        {nextClass ? (
          <Link
            href="/student/mis-clases"
            className="mt-4 block rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:bg-white/[0.04]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                  Confirmada
                </span>
                <h2 className="mt-3 text-xl font-semibold text-white">{nextClass.activity}</h2>
                <p className="mt-1 text-sm font-medium text-fuchsia-300">{nextClass.discipline}</p>
                <p className="mt-3 text-sm text-zinc-300">
                  {formatDateTime(nextClass.starts_at, studio.timezone)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {[nextClass.space, nextClass.coach].filter(Boolean).join(" · ") ||
                    "Consulta los detalles de tu clase"}
                </p>
              </div>
              <span aria-hidden="true" className="mt-8 text-2xl text-zinc-500">
                ›
              </span>
            </div>
          </Link>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/15 p-6 text-center">
            <div
              aria-hidden="true"
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 text-xl text-zinc-400"
            >
              ◫
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">
              {noCredits
                ? "No tienes clases reservadas"
                : activePackage
                  ? "Aún no tienes clases reservadas"
                  : "No tienes clases reservadas"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
              {noCredits
                ? "Tu paquete ya no tiene clases disponibles. Puedes consultar las opciones para seguir entrenando."
                : activePackage
                  ? "Cuando reserves una clase, aparecerá aquí para que tengas tu siguiente entrenamiento siempre a la vista."
                  : "Adquiere un paquete para comenzar a reservar tus clases."}
            </p>
            <Link
              href={canReserve ? "/student/reservar" : "/student/paquete"}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              {canReserve ? "Reservar clase" : "Ver paquetes"}
            </Link>
          </div>
        )}
      </section>

      {activePackage ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                Mi paquete
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{activePackage.name}</h2>
            </div>
            <Link href="/student/paquete" className="text-sm font-semibold text-fuchsia-300">
              Ver detalles
            </Link>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <strong className="text-3xl font-semibold text-white">
                {activePackage.unlimited ? "Ilimitado" : `${credits} clases`}
              </strong>
              <p className="mt-1 text-sm text-zinc-400">
                {activePackage.unlimited ? "Acceso disponible durante tu vigencia" : "disponibles"}
              </p>
            </div>

            <div className="sm:text-right">
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Vence</p>
                {expiresSoon ? (
                  <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                    Vence pronto
                  </span>
                ) : null}
              </div>
              <p className={`mt-1 font-semibold ${expiresSoon ? "text-amber-200" : "text-white"}`}>
                {formatDate(activePackage.expires_on, studio.timezone)}
              </p>
            </div>
          </div>

          {activePackage.unlimited ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-300">
              Tu paquete tiene acceso ilimitado. Las reservas continúan sujetas a disponibilidad y a
              las reglas vigentes de cada clase.
            </div>
          ) : (
            <div className="mt-5">
              <div
                className="h-2 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Clases utilizadas"
                aria-valuemin={0}
                aria-valuemax={packageLimit}
                aria-valuenow={activePackage.used_credits}
              >
                <div
                  className="h-full rounded-full bg-fuchsia-500"
                  style={{ width: `${usedProgress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>{activePackage.used_credits} utilizadas</span>
                <span>{packageLimit} en total</span>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Mi paquete
          </p>
          <h2 className="mt-3 text-xl font-semibold text-white">No tienes un paquete activo</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
            Consulta los paquetes disponibles y elige el que corresponda a tu entrenamiento.
          </p>
          <Link
            href="/student/paquete"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver paquetes
          </Link>
        </section>
      )}

      <section>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Acciones rápidas
        </p>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Link
            href="/student/reservar"
            className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] p-3 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-xl text-fuchsia-300">
              ◫
            </span>
            <span className="mt-2 text-xs font-semibold text-white sm:text-sm">Reservar clase</span>
          </Link>
          <Link
            href="/student/mis-clases"
            className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] p-3 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-xl text-fuchsia-300">
              ≡
            </span>
            <span className="mt-2 text-xs font-semibold text-white sm:text-sm">Ver mis clases</span>
          </Link>
          <Link
            href="/student/paquete"
            className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] p-3 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-xl text-fuchsia-300">
              ▭
            </span>
            <span className="mt-2 text-xs font-semibold text-white sm:text-sm">Ver mi paquete</span>
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_85%_20%,rgba(236,72,153,0.14),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-6 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-400">
          Disciplina también es amor propio
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
          <div>
            <strong className="block text-xl text-white">
              {snapshot.stats.attended_this_month}
            </strong>
            <span className="text-xs text-zinc-500">este mes</span>
          </div>
          <div>
            <strong className="block text-xl text-white">{snapshot.stats.attended_total}</strong>
            <span className="text-xs text-zinc-500">asistencias</span>
          </div>
          <div>
            <strong className="block text-xl text-white">{snapshot.stats.streak_days}</strong>
            <span className="text-xs text-zinc-500">días de racha</span>
          </div>
        </div>
      </section>
    </main>
  );
}
