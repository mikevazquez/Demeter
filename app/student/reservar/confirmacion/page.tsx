import Link from "next/link";

import {
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

export default async function StudentReservationConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; reservation?: string; date?: string }>;
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

  const sessionDate = session ? localDateKey(new Date(session.starts_at), studio.timezone) : null;
  const selectedDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;

  let assignedResourceName: string | null = null;
  if (query.reservation) {
    const { data: assignment } = await supabase
      .from("reservation_resource_assignments")
      .select("resource_id")
      .eq("reservation_id", query.reservation)
      .is("released_at", null)
      .maybeSingle();

    if (assignment?.resource_id) {
      const { data: resource } = await supabase
        .from("resources")
        .select("name")
        .eq("id", assignment.resource_id)
        .maybeSingle();
      assignedResourceName = resource?.name ?? null;
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-4 pb-4">
      <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.07] p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-2xl text-emerald-300">
          ✓
        </div>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Reserva confirmada
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">¡Listo! Tu lugar está reservado</h1>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
          Tu reserva quedó confirmada en Demeter.
        </p>

        {session ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
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
            {assignedResourceName ? (
              <p className="mt-2 text-[11px] font-semibold text-fuchsia-200">
                Lugar: {assignedResourceName}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          <Link
            href="/student/mis-clases"
            className="flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver mi clase
          </Link>
          <Link
            href={selectedDate ? `/student/reservar?date=${selectedDate}` : "/student/reservar"}
            className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-fuchsia-500/35 px-4 py-2.5 text-sm font-semibold text-fuchsia-200"
          >
            Reservar otra clase
          </Link>
        </div>
      </section>
    </main>
  );
}
