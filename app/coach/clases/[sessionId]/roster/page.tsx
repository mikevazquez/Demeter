import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import {
  formatSessionDate,
  formatTime,
  type CoachRosterItem,
  type CoachSessionDetail,
} from "@/lib/coach/portal";

import { setCoachAttendanceAction } from "../../../actions";

function attendanceLabel(status: CoachRosterItem["attendance_status"]) {
  if (status === "attended") return "Asistió";
  if (status === "no_show") return "No asistió";
  return "Pendiente";
}

function attendanceClass(status: CoachRosterItem["attendance_status"]) {
  if (status === "attended") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (status === "no_show") return "border-rose-400/20 bg-rose-400/10 text-rose-200";
  return "border-white/10 bg-white/[0.04] text-zinc-300";
}

export default async function CoachRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ updated?: string; walkin?: string; error?: string }>;
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
  const roster = (rosterData ?? []) as CoachRosterItem[];
  const attended = roster.filter((item) => item.attendance_status === "attended").length;
  const noShow = roster.filter((item) => item.attendance_status === "no_show").length;
  const pending = roster.filter((item) => item.attendance_status === "reserved").length;
  const editable = detail.status === "scheduled";
  const full = roster.length >= detail.capacity;

  return (
    <main className="space-y-6">
      <Link
        href={`/coach/clases/${sessionId}`}
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Detalle de clase
      </Link>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              Roster de la clase
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">{detail.activity}</h1>
            <p className="mt-2 capitalize text-sm text-zinc-400">
              {formatSessionDate(detail.starts_at, studio.timezone)} ·{" "}
              {formatTime(detail.starts_at, studio.timezone)} –{" "}
              {formatTime(detail.ends_at, studio.timezone)}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 px-4 py-3 text-right">
            <p className="text-xs text-zinc-500">En roster</p>
            <p className="mt-1 text-xl font-semibold text-white">
              {roster.length} / {detail.capacity}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-black/20 p-3">
            <p className="text-xs text-zinc-500">Asistieron</p>
            <p className="mt-1 text-lg font-semibold text-emerald-200">{attended}</p>
          </div>
          <div className="rounded-2xl bg-black/20 p-3">
            <p className="text-xs text-zinc-500">No asistieron</p>
            <p className="mt-1 text-lg font-semibold text-rose-200">{noShow}</p>
          </div>
          <div className="rounded-2xl bg-black/20 p-3">
            <p className="text-xs text-zinc-500">Pendientes</p>
            <p className="mt-1 text-lg font-semibold text-white">{pending}</p>
          </div>
        </div>

        {editable ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {full ? (
              <div className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-zinc-500">
                Clase llena · sin walk-ins
              </div>
            ) : (
              <Link
                href={`/coach/clases/${sessionId}/walk-in`}
                className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-center text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20"
              >
                + Agregar walk-in
              </Link>
            )}
            <Link
              href={`/coach/clases/${sessionId}/resumen`}
              className="rounded-xl bg-fuchsia-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Revisar resumen y finalizar
            </Link>
          </div>
        ) : detail.status === "completed" ? (
          <Link
            href={`/coach/clases/${sessionId}/finalizada`}
            className="mt-5 block rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/[0.05]"
          >
            Ver asistencia final
          </Link>
        ) : null}
      </section>

      {query.updated ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          Estado de asistencia actualizado.
        </div>
      ) : null}
      {query.walkin ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          Walk-in agregado al roster. No se creó ninguna compra automática.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          No pudimos actualizar la asistencia. La clase no fue modificada.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        {roster.length ? (
          <div className="divide-y divide-white/10">
            {roster.map((item) => (
              <article
                key={item.reservation_id}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold text-white">{item.student_name}</h2>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${attendanceClass(
                        item.attendance_status,
                      )}`}
                    >
                      {attendanceLabel(item.attendance_status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {item.package_name ??
                      (item.commercial_pending ? "Pendiente comercial" : "Sin paquete asociado")}
                  </p>
                </div>

                {editable ? (
                  <div className="grid grid-cols-2 gap-2 sm:shrink-0">
                    <form action={setCoachAttendanceAction}>
                      <input type="hidden" name="session_id" value={sessionId} />
                      <input type="hidden" name="reservation_id" value={item.reservation_id} />
                      <input type="hidden" name="status" value="attended" />
                      <button
                        type="submit"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-semibold transition ${
                          item.attendance_status === "attended"
                            ? "bg-emerald-500 text-white"
                            : "border border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                        }`}
                      >
                        Asistió
                      </button>
                    </form>
                    <form action={setCoachAttendanceAction}>
                      <input type="hidden" name="session_id" value={sessionId} />
                      <input type="hidden" name="reservation_id" value={item.reservation_id} />
                      <input type="hidden" name="status" value="no_show" />
                      <button
                        type="submit"
                        className={`w-full rounded-xl px-3 py-2 text-xs font-semibold transition ${
                          item.attendance_status === "no_show"
                            ? "bg-rose-500 text-white"
                            : "border border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                        }`}
                      >
                        No asistió
                      </button>
                    </form>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Asistencia cerrada</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-semibold text-white">Todavía no hay alumnas en el roster</p>
            <p className="mt-2 text-sm text-zinc-500">
              Las reservas activas de esta clase aparecerán aquí.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
