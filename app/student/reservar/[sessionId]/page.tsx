import Link from "next/link";
import { notFound } from "next/navigation";

import {
  bookingReasonCopy,
  formatDateTime,
  formatMoney,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

const DROP_IN_REASONS = new Set(["no_active_product", "outside_product", "no_credits"]);

export default async function StudentSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_session_detail", {
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const session = data as StudentSession;
  const eligible = Boolean(session.eligibility?.eligible);
  const alreadyReserved = Boolean(session.reservation_id);
  const reason = session.eligibility?.reason_code;
  const sessionDate = localDateKey(new Date(session.starts_at), studio.timezone);
  const returnDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;
  const showDropIn =
    !eligible &&
    Boolean(reason && DROP_IN_REASONS.has(reason)) &&
    session.drop_in_price_minor != null;
  const durationMinutes = Math.max(
    Math.round(
      (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000,
    ),
    0,
  );

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href={`/student/reservar?date=${returnDate}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver a clases
      </Link>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="bg-gradient-to-br from-fuchsia-500/[0.16] via-white/[0.035] to-transparent p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
            {session.discipline}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{session.activity}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {formatDateTime(session.starts_at, studio.timezone)}
            {durationMinutes ? ` · ${durationMinutes} min` : ""}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-white/10">
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Coach</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {session.coach ?? "Por confirmar"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Espacio</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {[session.location, session.space].filter(Boolean).join(" · ") || "Estudio"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Disponibilidad
            </dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {session.spots_available} de {session.capacity} lugares
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Reserva</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {session.eligibility?.unlimited
                ? "Incluida en ilimitado"
                : `${session.credit_cost} crédito${session.credit_cost === 1 ? "" : "s"}`}
            </dd>
          </div>
        </dl>

        {session.description ? (
          <div className="border-t border-white/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Sobre esta clase
            </p>
            <p className="mt-2 whitespace-pre-line text-xs leading-5 text-zinc-400">
              {session.description}
            </p>
          </div>
        ) : null}
      </section>

      {alreadyReserved ? (
        <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
          <p className="text-sm font-semibold text-emerald-200">✓ Ya tienes esta clase reservada</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Tu lugar está confirmado. Puedes consultar o gestionar esta reserva desde Mis clases.
          </p>
          <Link
            href="/student/mis-clases"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Ver Mis clases
          </Link>
        </section>
      ) : reason === "session_full" ? (
        <section className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.07] p-5">
          <p className="text-sm font-semibold text-rose-200">Esta clase ya está llena</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            No hay lugares disponibles. Elige otra clase de la agenda.
          </p>
          <Link
            href={`/student/reservar?date=${returnDate}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-fuchsia-500/40 px-4 py-2.5 text-sm font-semibold text-fuchsia-200"
          >
            Ver otras clases
          </Link>
        </section>
      ) : eligible ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs leading-5 text-zinc-400">
            {session.eligibility?.unlimited
              ? "Esta clase está incluida en tu membresía ilimitada."
              : `Tienes ${session.eligibility?.available_credits ?? 0} crédito(s) disponibles. Esta reserva utiliza ${session.credit_cost}.`}
          </p>
          <Link
            href={`/student/reservar/${session.session_id}/confirmar?date=${returnDate}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Reservar clase
          </Link>
        </section>
      ) : (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <p className="text-sm font-semibold text-amber-100">{bookingReasonCopy(reason)}</p>
          {showDropIn ? (
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Esta actividad tiene una clase suelta configurada en{" "}
              {formatMoney(session.drop_in_price_minor ?? 0)} MXN.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Studio Flow está aplicando las condiciones vigentes de tu cuenta y paquete.
            </p>
          )}
          <Link
            href="/student/paquete"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Ver mi paquete
          </Link>
        </section>
      )}
    </main>
  );
}
