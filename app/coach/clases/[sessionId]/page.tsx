import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import { formatSessionDate, formatTime, type CoachSessionDetail } from "@/lib/coach/portal";

function statusLabel(status: CoachSessionDetail["status"]) {
  if (status === "completed") return "Finalizada";
  if (status === "cancelled") return "Cancelada";
  return "Programada";
}

export default async function CoachClassDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.SCHEDULE_READ);
  const { data, error } = await supabase.rpc("coach_session_detail", {
    target_studio_id: studio.id,
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const detail = data as CoachSessionDetail;
  const occupied = Number(detail.reserved_count);
  const full = occupied >= detail.capacity;

  return (
    <main className="space-y-6">
      <Link
        href="/coach"
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Mis clases
      </Link>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 bg-gradient-to-br from-fuchsia-500/15 via-transparent to-transparent p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                Detalle de clase
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {detail.activity}
              </h1>
              <p className="mt-3 capitalize text-zinc-300">
                {formatSessionDate(detail.starts_at, studio.timezone)}
              </p>
            </div>
            <span className="self-start rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300">
              {statusLabel(detail.status)}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Horario</p>
            <p className="mt-1 font-semibold text-white">
              {formatTime(detail.starts_at, studio.timezone)} –{" "}
              {formatTime(detail.ends_at, studio.timezone)}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Espacio</p>
            <p className="mt-1 font-semibold text-white">
              {detail.space ?? "Espacio por confirmar"}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Ocupación</p>
            <p className="mt-1 font-semibold text-white">
              {occupied} / {detail.capacity}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Disponibilidad</p>
            <p className="mt-1 font-semibold text-white">
              {full ? "Clase llena" : `${detail.capacity - occupied} lugares disponibles`}
            </p>
          </div>
        </div>

        {detail.notes ? (
          <div className="mx-6 mb-6 rounded-2xl border border-white/10 p-4 text-sm leading-6 text-zinc-400 sm:mx-8 sm:mb-8">
            {detail.notes}
          </div>
        ) : null}

        <div className="border-t border-white/10 p-6 sm:p-8">
          <Link
            href={`/coach/clases/${sessionId}/roster`}
            className="block rounded-xl bg-fuchsia-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver roster
          </Link>
        </div>
      </section>
    </main>
  );
}
