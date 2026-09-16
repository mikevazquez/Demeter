import Link from "next/link";
import { notFound } from "next/navigation";

import {
  bookingReasonCopy,
  formatDateTime,
  getStudentPortalContext,
  type StudentSession,
} from "@/lib/student/portal";

import { bookStudentSessionAction } from "../../actions";

const errorCopy: Record<string, string> = {
  booking_failed: "No pudimos crear la reserva. Revisa las condiciones de la clase e intenta de nuevo.",
  forbidden: "Esta clase no pertenece a tu estudio o tu acceso no está habilitado.",
  session_not_found: "Esta clase ya no está disponible.",
};

export default async function StudentSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string }>;
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

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <Link href="/student/reservar" className="text-sm font-semibold text-fuchsia-300">
        ← Volver a clases
      </Link>

      {query.error ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error] ?? bookingReasonCopy(query.error)}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="bg-gradient-to-br from-fuchsia-500/20 via-white/[0.04] to-transparent p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
            {session.discipline}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">{session.activity}</h1>
          <p className="mt-3 text-base text-zinc-300">
            {formatDateTime(session.starts_at, studio.timezone)}
          </p>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Coach</p>
            <p className="mt-1 font-semibold text-white">{session.coach ?? "Por confirmar"}</p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Espacio</p>
            <p className="mt-1 font-semibold text-white">
              {[session.location, session.space].filter(Boolean).join(" · ") || "Estudio"}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Disponibilidad</p>
            <p className="mt-1 font-semibold text-white">
              {session.spots_available} de {session.capacity} lugares
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Costo de la reserva</p>
            <p className="mt-1 font-semibold text-white">
              {session.eligibility?.unlimited ? "Incluida en ilimitado" : `${session.credit_cost} crédito${session.credit_cost === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {session.description ? (
          <div className="border-t border-white/10 px-5 py-5 sm:px-6">
            <h2 className="font-semibold text-white">Descripción</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-400">
              {session.description}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-white">Tu reserva</h2>

        {alreadyReserved ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4">
            <p className="font-semibold text-emerald-200">✓ Ya tienes lugar en esta clase</p>
            <p className="mt-1 text-sm text-zinc-400">La encontrarás en Mis clases.</p>
            <Link
              href="/student/mis-clases"
              className="mt-4 inline-block rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Ver mis clases
            </Link>
          </div>
        ) : eligible ? (
          <>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
              <p>
                {session.eligibility?.unlimited
                  ? "Esta clase está incluida en tu membresía ilimitada."
                  : `Tienes ${session.eligibility?.available_credits ?? 0} crédito(s) disponibles. Al confirmar se reservará ${session.credit_cost}.`}
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Cancelaciones con al menos 8 horas de anticipación devuelven el crédito. Fuera de esa ventana, el crédito se consume según la política vigente.
              </p>
            </div>
            <form action={bookStudentSessionAction} className="mt-4">
              <input type="hidden" name="session_id" value={session.session_id} />
              <button
                type="submit"
                className="w-full rounded-2xl bg-fuchsia-600 px-5 py-3.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
              >
                Confirmar reserva
              </button>
            </form>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] p-4">
            <p className="font-semibold text-amber-100">{bookingReasonCopy(reason)}</p>
            <p className="mt-2 text-sm text-zinc-400">
              Studio Flow usa las mismas reglas de elegibilidad que administración; no se crean excepciones desde el portal.
            </p>
            <Link
              href="/student/paquete"
              className="mt-4 inline-block rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Ver mi paquete
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
