import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

const statusCopy: Record<string, string> = {
  reserved: "Reservada",
  attended: "Asististe",
  no_show: "No asististe",
  cancelled_on_time: "Cancelada",
  cancelled_late: "Cancelada",
  cancelled_by_studio: "Cancelada por el estudio",
};

function statusClass(status: string) {
  if (status === "attended") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "no_show") {
    return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  }
  if (status.startsWith("cancelled")) {
    return "border-zinc-500/25 bg-zinc-500/10 text-zinc-400";
  }
  return "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-200";
}

export default async function StudentReservationDetailPage({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}) {
  const { reservationId } = await params;
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_classes_feed");

  if (error || !data) {
    throw new Error("student_classes_feed_failed");
  }

  const feed = data as {
    upcoming?: StudentClassFeedItem[];
    history?: StudentClassFeedItem[];
  };
  const upcoming = feed.upcoming ?? [];
  const history = feed.history ?? [];
  const item =
    upcoming.find((entry) => entry.reservation_id === reservationId) ??
    history.find((entry) => entry.reservation_id === reservationId);

  if (!item) notFound();

  const isActiveReservation = item.status === "reserved";

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href="/student/mis-clases"
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Mis clases
      </Link>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="bg-gradient-to-br from-fuchsia-500/[0.14] via-white/[0.035] to-transparent p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                {item.discipline}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                {item.activity}
              </h1>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(item.status)}`}
            >
              {statusCopy[item.status] ?? item.status}
            </span>
          </div>

          <p className="mt-3 text-sm font-medium text-zinc-200">
            {formatDateTime(item.starts_at, studio.timezone)}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-white/10">
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Coach
            </dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {item.coach ?? "Por confirmar"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Espacio
            </dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {item.space ?? "Estudio"}
            </dd>
          </div>
        </dl>
      </section>

      {isActiveReservation ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Gestionar reserva
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Puedes cancelar esta reserva. El resultado se procesará con las
            políticas vigentes del estudio.
          </p>
          <Link
            href={`/student/mis-clases/${item.reservation_id}/cancelar`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/[0.08] px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/[0.14]"
          >
            Cancelar reserva
          </Link>
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold text-white">
            Esta reserva ya no está activa
          </p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Su estado actual es {statusCopy[item.status] ?? item.status}. No hay
            acciones pendientes.
          </p>
          <Link
            href="/student/mis-clases?view=history"
            className="mt-4 inline-flex text-xs font-semibold text-fuchsia-300"
          >
            Volver al historial
          </Link>
        </section>
      )}
    </main>
  );
}
