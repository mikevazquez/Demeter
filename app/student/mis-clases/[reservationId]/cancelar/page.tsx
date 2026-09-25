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
  searchParams,
}: {
  params: Promise<{ reservationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { reservationId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();
  const [{ data, error }, { data: previewData }, { data: invitationContextData }] =
    await Promise.all([
      supabase.rpc("student_classes_feed"),
      supabase.rpc("student_cancellation_preview", {
        target_reservation_id: reservationId,
      }),
      supabase.rpc("student_reward_invitation_context", {
        target_host_reservation_id: reservationId,
      }),
    ]);

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

  const preview = previewData as {
    ok?: boolean;
    late?: boolean;
    uses_credits?: boolean;
    unlimited?: boolean;
    credit_will_return?: boolean | null;
    credit_cost?: number | null;
  } | null;
  const willLoseCredit = Boolean(preview?.ok && preview.late && preview.uses_credits);
  const willReturnCredit = Boolean(
    preview?.ok && !preview.late && preview.credit_will_return === true,
  );
  const lateUnlimited = Boolean(preview?.ok && preview.late && preview.unlimited);
  const classesAffected = Math.max(preview?.credit_cost ?? 1, 1);
  const activeGuests =
    (
      invitationContextData as {
        active_guests?: Array<{
          invitation_id: string;
          guest_name: string;
          status: string;
        }>;
      } | null
    )?.active_guests?.filter((guest) => guest.status === "active") ?? [];
  const activeGuestNames = activeGuests.map((guest) => guest.guest_name).filter(Boolean);

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
            Esta reserva ya cambió de estado
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Ya no está activa, así que no hay ninguna cancelación pendiente.
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

        {activeGuests.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.09] p-4">
            <p className="text-sm font-semibold text-rose-100">
              También se cancelará{" "}
              {activeGuests.length === 1 ? "la invitación" : "las invitaciones"}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-rose-100/80">
              {activeGuests.length === 1
                ? `${activeGuestNames[0] ?? "Tu invitado"} ya no podrá asistir a esta clase.`
                : `${activeGuestNames.join(", ")} ya no podrán asistir a esta clase.`}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-zinc-400">
              La invitación depende de tu reserva en esta misma clase y se cancelará automáticamente
              al cancelar tu lugar.
            </p>
          </div>
        ) : null}

        {willLoseCredit ? (
          <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] p-4">
            <p className="text-sm font-semibold text-amber-100">Estás cancelando tarde</p>
            <p className="mt-1.5 text-sm leading-6 text-amber-100/80">
              Si continúas, perderás {classesAffected} {classesAffected === 1 ? "clase" : "clases"}{" "}
              de tu paquete.
            </p>
          </div>
        ) : willReturnCredit ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
            <p className="text-sm font-semibold text-emerald-100">
              Puedes cancelar sin perder tu clase
            </p>
            <p className="mt-1.5 text-sm leading-6 text-emerald-100/80">
              Se devolverán {classesAffected} {classesAffected === 1 ? "clase" : "clases"} a tu
              paquete.
            </p>
          </div>
        ) : lateUnlimited ? (
          <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] p-4">
            <p className="text-sm font-semibold text-amber-100">Estás cancelando tarde</p>
            <p className="mt-1.5 text-sm leading-6 text-amber-100/80">
              Tu membresía es ilimitada. Antes de confirmar, considera las condiciones vigentes para
              cancelaciones tardías.
            </p>
          </div>
        ) : null}

        {query.error ? (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/[0.08] p-4"
          >
            <p className="text-sm font-semibold text-rose-100">
              No se pudo procesar tu cancelación
            </p>
            <p className="mt-1.5 text-xs leading-5 text-rose-100/75">
              Tu reserva no se modificó. Puedes intentarlo de nuevo.
            </p>
          </div>
        ) : null}

        <form action={cancelStudentReservationAction} className="mt-5 space-y-3">
          <input type="hidden" name="reservation_id" value={item.reservation_id} />
          <input type="hidden" name="return_to" value="/student/mis-clases" />
          <label className="block text-sm text-zinc-400">
            ¿Quieres contarnos por qué?
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
            {query.error
              ? "Intentar de nuevo"
              : activeGuests.length > 0
                ? activeGuests.length === 1
                  ? "Sí, cancelar mi reserva y la invitación"
                  : "Sí, cancelar mi reserva y las invitaciones"
                : willLoseCredit
                  ? `Cancelar y perder ${classesAffected} ${classesAffected === 1 ? "clase" : "clases"}`
                  : "Cancelar mi reserva"}
          </PendingActionButton>

          <Link
            href={`/student/mis-clases/${item.reservation_id}`}
            className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300"
          >
            Mantener mi reserva
          </Link>
        </form>
      </section>
    </main>
  );
}
