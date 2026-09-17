import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import { type CoachRosterItem, type CoachSessionDetail } from "@/lib/coach/portal";

import { finalizeCoachAttendanceAction } from "../../../actions";

export default async function CoachAttendanceSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const [{ data: detailData, error: detailError }, { data: rosterData, error: rosterError }] =
    await Promise.all([
      supabase.rpc("coach_session_detail", {
        target_studio_id: studio.id,
        target_session_id: sessionId,
      }),
      supabase.rpc("coach_session_roster", {
        target_studio_id: studio.id,
        target_session_id: sessionId,
      }),
    ]);

  if (detailError || rosterError || !detailData) notFound();

  const detail = detailData as CoachSessionDetail;
  if (detail.status === "completed") redirect(`/coach/clases/${sessionId}/finalizada`);

  const roster = (rosterData ?? []) as CoachRosterItem[];
  const attended = roster.filter((item) => item.attendance_status === "attended").length;
  const noShow = roster.filter((item) => item.attendance_status === "no_show").length;
  const pending = roster.filter((item) => item.attendance_status === "reserved").length;
  const canFinalize = detail.status === "scheduled";

  return (
    <main className="space-y-6">
      <Link
        href={`/coach/clases/${sessionId}/roster`}
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Volver al roster
      </Link>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
          Resumen de asistencia
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{detail.activity}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Revisa los conteos antes de finalizar. Una vez cerrada la clase, cualquier corrección
          exige un motivo.
        </p>
      </section>

      {query.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          No pudimos finalizar la asistencia. La clase permanece abierta.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">
            Asistieron
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{attended}</p>
        </div>
        <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">
            No asistieron
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{noShow}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Pendientes
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{pending}</p>
        </div>
      </section>

      {pending > 0 ? (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5 text-amber-100">
          <h2 className="font-semibold">Hay {pending} asistencia pendiente</h2>
          <p className="mt-2 text-sm leading-6 text-amber-100/80">
            Al finalizar, las reservas que sigan pendientes se marcarán como no-show conforme al
            cierre canónico de asistencia.
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        {canFinalize ? (
          <form action={finalizeCoachAttendanceAction}>
            <input type="hidden" name="session_id" value={sessionId} />
            <button
              type="submit"
              className="w-full rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Confirmar y finalizar asistencia
            </button>
          </form>
        ) : (
          <p className="text-sm text-zinc-400">
            Esta sesión no se puede finalizar desde su estado actual.
          </p>
        )}
      </section>
    </main>
  );
}
