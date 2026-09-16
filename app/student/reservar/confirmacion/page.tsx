import Link from "next/link";

import { formatDateTime, getStudentPortalContext, type StudentSession } from "@/lib/student/portal";

export default async function StudentReservationConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; reservation?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();

  let session: StudentSession | null = null;
  if (query.session) {
    const { data } = await supabase.rpc("student_session_detail", {
      target_session_id: query.session,
    });
    session = (data as StudentSession | null) ?? null;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.08] p-6 text-center sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-300">
          ✓
        </div>
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Reserva confirmada
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">¡Tu lugar está listo!</h1>
        <p className="mt-2 text-sm text-zinc-400">
          La reserva ya está registrada y tu saldo de clases refleja el hold correspondiente.
        </p>

        {session ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
              {session.discipline}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">{session.activity}</h2>
            <p className="mt-2 text-sm text-zinc-400">
              {formatDateTime(session.starts_at, studio.timezone)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {[session.coach, session.space || session.location].filter(Boolean).join(" · ")}
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/student/mis-clases"
            className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Ver mis clases
          </Link>
          <Link
            href="/student/reservar"
            className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.05]"
          >
            Reservar otra clase
          </Link>
        </div>
      </section>
    </main>
  );
}
