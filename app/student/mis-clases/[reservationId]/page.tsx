import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

import {
  cancelGuestInvitationAction,
  confirmExistingGuestInvitationAction,
  createGuestInvitationAction,
} from "../../actions";

const statusCopy: Record<string, string> = {
  reserved: "Reservada",
  attended: "Asististe",
  no_show: "No asististe",
  cancelled_on_time: "Cancelada",
  cancelled_late: "Cancelada",
  cancelled_by_studio: "Cancelada por el estudio",
};

type InvitationGuest = {
  invitation_id: string;
  guest_reservation_id: string;
  guest_name: string;
  phone: string | null;
  status: string;
};

type InvitationContext = {
  level_title?: string | null;
  total?: number;
  used?: number;
  remaining?: number;
  spots_available?: number;
  can_invite?: boolean;
  active_guests?: InvitationGuest[];
};

type InvitationContactMatch = {
  ok?: boolean;
  person_id?: string;
  display_name?: string | null;
  lifecycle_status?: string | null;
};

const inviteErrorCopy: Record<string, string> = {
  guest_name_required: "Escribe el nombre completo de tu invitado.",
  guest_phone_invalid: "Usa un teléfono válido con código de país, por ejemplo +5213312345678.",
  no_invites_remaining: "Ya utilizaste las invitaciones disponibles de este mes.",
  session_full: "Ya no hay un cupo adicional disponible para tu invitado.",
  session_not_bookable: "Esta clase ya no admite invitaciones.",
  host_reservation_not_active: "Tu reserva debe seguir activa para invitar a alguien.",
  guest_already_reserved: "Esta persona ya tiene un lugar en la clase.",
  guest_already_student:
    "Ese teléfono ya pertenece a una alumna inscrita. Este caso requiere una regla específica de invitaciones.",
  invitation_not_found: "No encontramos esa invitación.",
  invitation_not_cancellable: "Esta invitación ya no se puede cancelar.",
  invite_cancel_failed: "No pudimos cancelar la invitación.",
  invite_failed: "No pudimos confirmar la invitación. Intenta nuevamente.",
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
  searchParams,
}: {
  params: Promise<{ reservationId: string }>;
  searchParams: Promise<{
    invite?: string;
    invited?: string;
    invite_error?: string;
    guest_cancelled?: string;
    contact_match?: string;
  }>;
}) {
  const { reservationId } = await params;
  const query = await searchParams;
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
  const { data: invitationContextData } = isActiveReservation
    ? await supabase.rpc("student_reward_invitation_context", {
        target_host_reservation_id: reservationId,
      })
    : { data: null };
  const invitationContext = (invitationContextData as InvitationContext | null) ?? null;
  const { data: contactMatchData } =
    isActiveReservation && query.contact_match
      ? await supabase.rpc("student_guest_invitation_contact_identity", {
          target_guest_person_id: query.contact_match,
        })
      : { data: null };
  const contactMatch = (contactMatchData as InvitationContactMatch | null) ?? null;
  const activeGuests = invitationContext?.active_guests ?? [];
  const invitationTotal = invitationContext?.total ?? 0;
  const invitationRemaining = invitationContext?.remaining ?? 0;
  const showInvitationBenefit = invitationTotal > 0 || activeGuests.length > 0;
  const inviteError = query.invite_error
    ? (inviteErrorCopy[query.invite_error] ?? inviteErrorCopy.invite_failed)
    : null;

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href="/student/mis-clases"
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Mis clases
      </Link>

      {inviteError && query.invite !== "1" ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100">
          {inviteError}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="bg-gradient-to-br from-fuchsia-500/[0.14] via-white/[0.035] to-transparent p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                {item.discipline}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-white">{item.activity}</h1>
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
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Coach</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {item.coach ?? "Por confirmar"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Espacio</dt>
            <dd className="mt-1 text-xs font-semibold text-white">{item.space ?? "Estudio"}</dd>
          </div>
        </dl>
      </section>

      {isActiveReservation && showInvitationBenefit ? (
        <section
          data-feature="sf255-guest-invitations"
          className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.045] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                Invitaciones
              </p>
              <h2 className="mt-1 text-base font-semibold text-white">Comparte esta clase</h2>
            </div>
            <span className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
              {invitationRemaining} de {invitationTotal} disponibles
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Tu invitado asistirá a esta misma clase contigo y ocupará un lugar real del aforo.
          </p>

          {activeGuests.length ? (
            <div className="mt-3 space-y-2">
              {activeGuests.map((guest) => (
                <div
                  key={guest.invitation_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{guest.guest_name}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {guest.status === "active" ? "Invitación confirmada" : guest.status}
                    </p>
                  </div>
                  {guest.status === "active" ? (
                    <form action={cancelGuestInvitationAction}>
                      <input type="hidden" name="host_reservation_id" value={reservationId} />
                      <input type="hidden" name="invitation_id" value={guest.invitation_id} />
                      <button
                        type="submit"
                        className="rounded-xl border border-rose-500/25 px-3 py-2 text-[11px] font-semibold text-rose-200"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {invitationContext?.can_invite ? (
            <Link
              href={`/student/mis-clases/${reservationId}?invite=1`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Invitar a alguien
            </Link>
          ) : invitationRemaining > 0 && (invitationContext?.spots_available ?? 0) <= 0 ? (
            <p className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-100">
              No hay un cupo adicional disponible en este momento.
            </p>
          ) : invitationRemaining <= 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              Ya utilizaste las invitaciones disponibles de este mes.
            </p>
          ) : null}
        </section>
      ) : null}

      {isActiveReservation ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Gestionar reserva
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Puedes cancelar esta reserva. El resultado se procesará con las políticas vigentes del
            estudio.
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
          <p className="text-sm font-semibold text-white">Esta reserva ya no está activa</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Su estado actual es {statusCopy[item.status] ?? item.status}. No hay acciones
            pendientes.
          </p>
          <Link
            href="/student/mis-clases?view=history"
            className="mt-4 inline-flex text-xs font-semibold text-fuchsia-300"
          >
            Volver al historial
          </Link>
        </section>
      )}
      {query.invite === "1" && invitationContext?.can_invite ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-invite-title"
            className="w-full max-w-md rounded-3xl border border-fuchsia-500/25 bg-[#160d16] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                  Invitación
                </p>
                <h2 id="guest-invite-title" className="mt-1 text-2xl font-semibold text-white">
                  Invitar a alguien
                </h2>
              </div>
              <Link
                href={`/student/mis-clases/${reservationId}`}
                aria-label="Cerrar"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400"
              >
                ×
              </Link>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-semibold text-white">{item.activity}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {formatDateTime(item.starts_at, studio.timezone)}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">{item.space ?? "Estudio"}</p>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-300">
              Tu invitado asistirá a esta misma clase contigo.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Usarás 1 invitación · después te quedará {Math.max(invitationRemaining - 1, 0)} este
              mes.
            </p>

            {inviteError ? (
              <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.07] px-3 py-2.5 text-xs leading-5 text-rose-100">
                {inviteError}
              </div>
            ) : null}

            {contactMatch?.ok &&
            contactMatch.person_id &&
            contactMatch.display_name &&
            contactMatch.lifecycle_status !== "student" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                    Contacto encontrado
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">
                    Este teléfono ya pertenece a{" "}
                    <strong className="font-semibold text-white">
                      {contactMatch.display_name}
                    </strong>
                    . Usaremos ese contacto para esta invitación.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    No cambiaremos su nombre ni crearemos un registro duplicado.
                  </p>
                </div>

                <form action={confirmExistingGuestInvitationAction}>
                  <input type="hidden" name="reservation_id" value={reservationId} />
                  <input type="hidden" name="guest_person_id" value={contactMatch.person_id} />
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                  >
                    Usar este contacto
                  </button>
                </form>

                <Link
                  href={`/student/mis-clases/${reservationId}?invite=1`}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300"
                >
                  Corregir datos
                </Link>
              </div>
            ) : (
              <form action={createGuestInvitationAction} className="mt-4 space-y-3">
                <input type="hidden" name="reservation_id" value={reservationId} />
                <label className="block text-xs font-medium text-zinc-300">
                  Nombre completo
                  <input
                    name="guest_name"
                    required
                    autoComplete="name"
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-fuchsia-500/60"
                    placeholder="Nombre y apellidos"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-300">
                  Número de teléfono
                  <input
                    name="guest_phone"
                    type="tel"
                    required
                    inputMode="tel"
                    pattern="\+[1-9][0-9]{7,14}"
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-fuchsia-500/60"
                    placeholder="+5213312345678"
                  />
                  <span className="mt-1 block text-[10px] text-zinc-600">
                    Incluye código de país.
                  </span>
                </label>

                <button
                  type="submit"
                  className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                >
                  Confirmar invitación
                </button>
                <Link
                  href={`/student/mis-clases/${reservationId}`}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300"
                >
                  Cancelar
                </Link>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
