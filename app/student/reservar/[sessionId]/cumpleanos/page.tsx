import Link from "next/link";
import { notFound } from "next/navigation";

import {
  birthdayBookingErrorCopy,
  birthdayDateLabel,
  birthdayPassFitsSession,
  type BirthdayPassSnapshot,
} from "@/lib/birthday/pass";
import {
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import PendingActionButton from "../../../components/PendingActionButton";
import { bookWithBirthdayPassAction } from "./actions";
import BirthdayRecipientFields from "./BirthdayRecipientFields";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// CUMP-01-06 · Reservar con el pase de cumpleaños: para ella o para una amiga.
export default async function BirthdayPassBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string; error?: string; listo?: string; para?: string }>;
}) {
  const [{ sessionId }, query, { supabase, studio }] = await Promise.all([
    params,
    searchParams,
    getStudentPortalContext(),
  ]);
  const [{ data, error }, { data: passData }] = await Promise.all([
    supabase.rpc("student_session_detail", { target_session_id: sessionId }),
    supabase.rpc("student_birthday_pass_snapshot"),
  ]);
  if (error || !data) notFound();

  const session = data as StudentSession;
  const pass = (passData ?? null) as BirthdayPassSnapshot | null;
  const sessionDate = localDateKey(new Date(session.starts_at), studio.timezone);
  const returnDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;
  const done = query.listo === "propia" || query.listo === "amiga" ? query.listo : null;
  const fits = birthdayPassFitsSession(pass, session, sessionDate);
  const friendAllowed = pass?.friend_enabled !== false;
  const selfAllowed = !session.reservation_id;
  const canUse = fits && (selfAllowed || friendAllowed);
  const errorCopy = birthdayBookingErrorCopy(query.error);

  return (
    <main className="mx-auto max-w-md space-y-4 pb-4">
      <Link
        href={`/student/reservar/${session.session_id}?date=${returnDate}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver al detalle
      </Link>

      <section className="rounded-3xl border border-[#f6d67a]/25 bg-[linear-gradient(145deg,rgba(246,214,122,0.09),rgba(205,184,236,0.04)),rgba(255,255,255,0.025)] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f6d67a]">
          Pase de cumpleaños
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">
          {done ? "¡Listo, lugar reservado!" : "Usa tu regalo en esta clase"}
        </h1>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f6d67a]">
            {session.discipline}
          </p>
          <p className="mt-1 text-base font-semibold text-white">{session.activity}</p>
          <p className="mt-2 text-xs text-zinc-300">
            {formatDateTime(session.starts_at, studio.timezone)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {[session.coach, session.space || session.location].filter(Boolean).join(" · ") ||
              "Estudio"}
          </p>
        </div>

        {done ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
            <p className="text-sm font-semibold text-emerald-200">
              {done === "amiga"
                ? "Le guardamos el lugar a tu amiga."
                : "Tu clase de cumpleaños está confirmada."}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-zinc-400">
              No se usaron créditos de tu paquete. Si cancelas a tiempo, el pase vuelve a tu
              portal mientras siga tu mes.
            </p>
            <Link
              href={done === "amiga" ? "/student" : "/student/mis-clases"}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[#f6d67a] px-4 py-2.5 text-sm font-bold text-[#26231b]"
            >
              {done === "amiga" ? "Volver al inicio" : "Ver Mis clases"}
            </Link>
          </div>
        ) : !canUse ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
            <p className="text-sm font-semibold text-amber-100">
              {!pass?.eligible || pass.state !== "available"
                ? pass?.state === "used"
                  ? "Tu pase de cumpleaños ya fue utilizado."
                  : "No tienes un pase de cumpleaños disponible."
                : !selfAllowed && !friendAllowed
                  ? "Ya tienes esta clase reservada."
                  : session.requires_resource
                  ? "Esta clase requiere elegir lugar; usa tu pase en otra clase."
                  : session.spots_available <= 0
                    ? "Esta clase ya está llena."
                    : `El pase sirve para clases hasta el ${birthdayDateLabel(pass.expires_on) ?? "fin de tu mes"}.`}
            </p>
            <Link
              href={`/student/reservar?date=${returnDate}&pase=cumpleanos`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Elegir otra clase
            </Link>
          </div>
        ) : (
          <form action={bookWithBirthdayPassAction} className="mt-5 space-y-4">
            <input type="hidden" name="session_id" value={session.session_id} />
            <input type="hidden" name="date" value={returnDate} />
            {errorCopy ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.08] p-3 text-xs leading-5 text-rose-100"
              >
                {errorCopy}
              </div>
            ) : null}
            <BirthdayRecipientFields
              initialRecipient={query.para === "amiga" ? "friend" : "self"}
              selfAllowed={selfAllowed}
              friendAllowed={friendAllowed}
            />
            <p className="text-[11px] leading-5 text-zinc-500">
              Es tu regalo: no descuenta clases de tu paquete. Se usa una sola vez.
            </p>
            <PendingActionButton
              pendingLabel="Reservando…"
              className="min-h-11 w-full rounded-2xl bg-[#f6d67a] px-4 py-2.5 text-sm font-bold text-[#26231b] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            >
              Usar mi pase
            </PendingActionButton>
          </form>
        )}
      </section>
    </main>
  );
}
