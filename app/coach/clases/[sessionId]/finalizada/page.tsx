import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import { type CoachRosterItem, type CoachSessionDetail } from "@/lib/coach/portal";

import { correctCoachAttendanceAction } from "../../../actions";

export default async function CoachFinalizedPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ corrected?: string; error?: string }>;
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
  if (detail.status !== "completed") redirect(`/coach/clases/${sessionId}/resumen`);

  const roster = (rosterData ?? []) as CoachRosterItem[];
  const attended = roster.filter((item) => item.attendance_status === "attended").length;
  const noShow = roster.filter((item) => item.attendance_status === "no_show").length;

  return (
    <main className="space-y-6">
      <Link
        href="/coach"
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Mis clases
      </Link>

      <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Clase finalizada
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{detail.activity}</h1>
        <p className="mt-2 text-sm leading-6 text-emerald-100/80">
          La asistencia quedó cerrada. Las correcciones posteriores requieren un motivo y quedan
          registradas por el flujo canónico de asistencia.
        </p>
      </section>

      {query.corrected ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          Corrección registrada.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {query.error === "reason"
            ? "Escribe el motivo de la corrección."
            : "No pudimos registrar la corrección."}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
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
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Asistencia final</h2>
          <p className="mt-1 text-sm text-zinc-500">Usa corrección sólo cuando exista un error real.</p>
        </div>
        <div className="divide-y divide-white/10">
          {roster.map((item) => {
            const attendedNow = item.attendance_status === "attended";
            const targetStatus = attendedNow ? "no_show" : "attended";

            return (
              <article key={item.reservation_id} className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{item.student_name}</h3>
                    <p className={`mt-1 text-sm ${attendedNow ? "text-emerald-200" : "text-rose-200"}`}>
                      {attendedNow ? "Asistió" : "No asistió"}
                    </p>
                  </div>
                  <form action={correctCoachAttendanceAction} className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="session_id" value={sessionId} />
                    <input type="hidden" name="reservation_id" value={item.reservation_id} />
                    <input type="hidden" name="status" value={targetStatus} />
                    <input
                      name="reason"
                      required
                      placeholder="Motivo obligatorio de la corrección"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/50"
                    />
                    <button
                      type="submit"
                      className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.05]"
                    >
                      Cambiar a {attendedNow ? "No asistió" : "Asistió"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
