import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

import { cancelGuestInvitationAction } from "../../../../../actions";

type InvitationGuest = {
  invitation_id: string;
  guest_reservation_id: string;
  guest_name: string;
  phone: string | null;
  status: string;
};

type InvitationContext = {
  active_guests?: InvitationGuest[];
};

export default async function StudentCancelGuestInvitationPage({
  params,
}: {
  params: Promise<{ reservationId: string; invitationId: string }>;
}) {
  const { reservationId, invitationId } = await params;
  const { supabase, studio } = await getStudentPortalContext();

  const [{ data: classesData, error: classesError }, { data: invitationContextData }, { data: previewData }] =
    await Promise.all([
      supabase.rpc("student_classes_feed"),
      supabase.rpc("student_reward_invitation_context", {
        target_host_reservation_id: reservationId,
      }),
      supabase.rpc("student_cancellation_preview", {
        target_reservation_id: reservationId,
      }),
    ]);

  if (classesError || !classesData) {
    throw new Error("student_classes_feed_failed");
  }

  const feed = classesData as {
    upcoming?: StudentClassFeedItem[];
    history?: StudentClassFeedItem[];
  };
  const item =
    (feed.upcoming ?? []).find((entry) => entry.reservation_id === reservationId) ??
    (feed.history ?? []).find((entry) => entry.reservation_id === reservationId);

  if (!item) notFound();

  const invitationContext = (invitationContextData as InvitationContext | null) ?? null;
  const guest =
    invitationContext?.active_guests?.find(
      (entry) => entry.invitation_id === invitationId && entry.status === "active",
    ) ?? null;

  const preview = previewData as {
    ok?: boolean;
    late?: boolean;
  } | null;
  const isLate = Boolean(preview?.ok && preview.late);

  if (!guest) {
    return (
      <main className="mx-auto max-w-md space-y-4 pb-4">
        <Link
          href={`/student/mis-clases/${reservationId}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
        >
          <span aria-hidden="true">←</span>
          Volver
        </Link>

        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-6 text-center">
          <h1 className="text-xl font-semibold text-white">Esta invitación ya cambió de estado</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Ya no está activa, así que no hay ninguna cancelación pendiente.
          </p>
          <Link
            href={`/student/mis-clases/${reservationId}`}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Volver a la reserva
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 pb-4">
      <Link
        href={`/student/mis-clases/${reservationId}`}
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
          Cancelar invitación
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">
          ¿Cancelar el lugar de {guest.guest_name}?
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

        {isLate ? (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.08] p-4">
            <p className="text-sm font-semibold text-amber-100">
              Estás fuera del horario de cancelación
            </p>
            <p className="mt-1.5 text-xs leading-5 text-amber-100/80">
              {guest.guest_name} perderá su lugar en esta clase y la invitación se consumirá. No
              regresará a tu saldo de este mes.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
            <p className="text-xs leading-5 text-emerald-100">
              {guest.guest_name} perderá su lugar en esta clase, pero la invitación regresará a tu
              saldo de este mes.
            </p>
          </div>
        )}

        <form action={cancelGuestInvitationAction} className="mt-5 space-y-3">
          <input type="hidden" name="host_reservation_id" value={reservationId} />
          <input type="hidden" name="invitation_id" value={guest.invitation_id} />
          <button
            type="submit"
            className="min-h-11 w-full rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
          >
            {isLate ? "Sí, cancelar y consumir invitación" : "Sí, cancelar invitación"}
          </button>

          <Link
            href={`/student/mis-clases/${reservationId}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300"
          >
            No, mantener invitación
          </Link>
        </form>
      </section>
    </main>
  );
}
