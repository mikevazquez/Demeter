import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import { type CoachRosterItem, type CoachSessionDetail } from "@/lib/coach/portal";

export default async function CoachFinalizedPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
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
  if (detail.status !== "completed") redirect(`/coach/clases/${sessionId}/roster`);

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

      <section className="rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.09] via-white/[0.025] to-transparent p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
          Clase finalizada
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{detail.activity}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Studio Flow cerró la asistencia automáticamente al terminar la clase. Las correcciones
          posteriores las realiza Administración.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">
            Asistieron
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">{attended}</p>
        </div>
        <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">No show</p>
          <p className="mt-2 text-3xl font-semibold text-white">{noShow}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Asistencia final</h2>
          <p className="mt-1 text-sm text-zinc-500">Vista de consulta para Coach.</p>
        </div>
        <div className="divide-y divide-white/10">
          {roster.map((item) => {
            const attendedNow = item.attendance_status === "attended";
            return (
              <article
                key={item.reservation_id}
                className="flex items-center justify-between gap-4 p-5 sm:p-6"
              >
                <div>
                  <h3 className="font-semibold text-white">{item.student_name}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{item.package_name ?? "Sin paquete"}</p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    attendedNow
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                      : "border-rose-400/20 bg-rose-400/10 text-rose-200"
                  }`}
                >
                  {attendedNow ? "Asistió" : "No show"}
                </span>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
