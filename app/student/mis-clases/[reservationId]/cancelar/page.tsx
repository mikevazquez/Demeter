import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

import { cancelStudentReservationAction } from "../../../actions";
import PendingActionButton from "../../../components/PendingActionButton";

export default async function StudentCancelReservationPage({
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
  const item =
    (feed.upcoming ?? []).find((entry) => entry.reservation_id === reservationId) ??
    (feed.history ?? []).find((entry) => entry.reservation_id === reservationId);

  if (!item) notFound();

  if (item.status !== "reserved") {
    return (
      <main className="mx-auto max-w-md space-y-4 pb-4">
        <Link
          href={`/student/mis-clases/${item.reservation_id}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
        >
          <span aria-hidden="true">←</span>
          Volver
        </Link>

        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-6 text-center">
          <div
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/25 text-xl text-amber-200"
          >
            ⌑
          </div>
          <h1 className="mt-4 text-xl font-semibold text-white">
            Esta clase ya no se puede cancelar
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            La reserva cambió de estado. No se realizó ninguna modificación.
          </p>
          <Link
            href="/student/mis-clases"
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Volver a Mis clases
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 pb-4">
      <Link
        href={`/student/mis-clases/${item.reservation_id}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver
      </Link>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/[0.08] text-xl font-bold text-rose-200"
        >
          !
        </div>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-300">
          Cancelar reserva
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">
          ¿Seguro que quieres cancelar esta clase?
        </h1>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm font-semibold text-white">{item.activity}</p>
          <p className="mt-1 text-xs font-medium text-fuchsia-300">{item.discipline}</p>
          <p className="mt-2 text-xs text-zinc-300">
            {formatDateTime(item.starts_at, studio.timezone)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {[item.coach, item.space].filter(Boolean).join(" · ") || "Estudio"}
          </p>
        </div>

        <p className="mt-4 text-xs leading-5 text-zinc-400">
          Studio Flow aplicará automáticamente la política vigente de cancelación y el tratamiento
          correspondiente de tus créditos.
        </p>

        <form action={cancelStudentReservationAction} className="mt-5 space-y-3">
          <input type="hidden" name="reservation_id" value={item.reservation_id} />
          <input type="hidden" name="return_to" value="/student/mis-clases" />
          <label className="block text-xs text-zinc-400">
            Motivo
            <span className="ml-1 text-zinc-600">(opcional)</span>
            <input
              name="reason"
              maxLength={250}
              placeholder="Cuéntanos si quieres"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-fuchsia-500/60"
            />
          </label>

          <PendingActionButton
            pendingLabel="Cancelando…"
            className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-70"
          >
            Sí, cancelar
          </PendingActionButton>

          <Link
            href={`/student/mis-clases/${item.reservation_id}`}
            className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300"
          >
            No, mantener
          </Link>
        </form>
      </section>
    </main>
  );
}
