import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  bookingReasonCopy,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import { bookStudentSessionAction } from "../../../actions";
import PendingActionButton from "../../../components/PendingActionButton";

const errorCopy: Record<string, string> = {
  booking_failed: "No se pudo realizar la reserva. Intenta de nuevo.",
  forbidden: "Tu cuenta no puede reservar esta clase.",
  session_not_found: "Esta clase ya no está disponible.",
  session_required: "No se pudo identificar la clase.",
  resource_required: "Selecciona un recurso antes de confirmar.",
  resource_full: "Ese recurso acaba de llenarse. Selecciona otro.",
  resource_not_available: "Ese recurso ya no está disponible.",
};

export default async function StudentBookingConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string; error?: string; resource?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_session_detail", {
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const session = data as StudentSession;
  const eligible = Boolean(session.eligibility?.eligible);
  const alreadyReserved = Boolean(session.reservation_id);
  const sessionDate = localDateKey(new Date(session.starts_at), studio.timezone);
  const returnDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;

  let selectedResource: {
    resource_id: string;
    name: string;
    short_label: string | null;
    type_name: string;
    enabled: boolean;
    available: number;
    capacity: number;
  } | null = null;

  if (session.requires_resource) {
    const { data: resourceData, error: resourceError } = await supabase.rpc(
      "student_session_resource_map",
      { target_session_id: session.session_id },
    );

    if (resourceError || !resourceData) {
      redirect(
        `/student/reservar/${session.session_id}/recurso?error=resource_not_available&date=${returnDate}`,
      );
    }

    const payload = resourceData as {
      resources?: Array<{
        resource_id: string;
        name: string;
        short_label: string | null;
        type_name: string;
        enabled: boolean;
        available: number;
        capacity: number;
      }>;
    };

    selectedResource =
      payload.resources?.find((resource) => resource.resource_id === query.resource) ?? null;

    if (!selectedResource || !selectedResource.enabled || selectedResource.available <= 0) {
      const errorCode = query.resource ? "resource_not_available" : "resource_required";
      redirect(
        `/student/reservar/${session.session_id}/recurso?error=${errorCode}&date=${returnDate}`,
      );
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-4 pb-4">
      <Link
        href={
          session.requires_resource
            ? `/student/reservar/${session.session_id}/recurso?date=${returnDate}`
            : `/student/reservar/${session.session_id}?date=${returnDate}`
        }
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        {session.requires_resource ? "Cambiar recurso" : "Volver al detalle"}
      </Link>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
          Confirmar reserva
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">
          Revisa tu clase antes de confirmar
        </h1>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            {session.discipline}
          </p>
          <p className="mt-1 text-base font-semibold text-white">{session.activity}</p>
          <p className="mt-2 text-xs text-zinc-300">
            {formatDateTime(session.starts_at, studio.timezone)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {[session.coach, session.space || session.location].filter(Boolean).join(" · ") ||
              "Estudio"}
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            {Math.max(session.capacity - session.spots_available, 0)} de {session.capacity} reservados
          </p>
          {selectedResource ? (
            <div className="mt-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
                Recurso seleccionado
              </p>
              <p className="mt-1 text-xs font-semibold text-white">{selectedResource.name}</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">{selectedResource.type_name}</p>
            </div>
          ) : null}
        </div>

        {query.error ? (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/[0.08] p-4"
          >
            <p className="text-sm font-semibold text-rose-100">No se pudo realizar la reserva</p>
            <p className="mt-1.5 text-xs leading-5 text-rose-100/75">
              {errorCopy[query.error] ?? bookingReasonCopy(query.error)}
            </p>
          </div>
        ) : null}

        {alreadyReserved ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
            <p className="text-sm font-semibold text-emerald-200">Ya tienes esta clase reservada</p>
            <Link
              href="/student/mis-clases"
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Ver Mis clases
            </Link>
          </div>
        ) : eligible ? (
          <>
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
              <p className="text-xs leading-5 text-amber-100">
                {session.eligibility?.unlimited
                  ? "Esta clase está incluida en tu membresía ilimitada."
                  : `Se utilizará ${session.credit_cost} crédito${session.credit_cost === 1 ? "" : "s"} de tu paquete activo.`}
              </p>
            </div>

            <form action={bookStudentSessionAction} className="mt-5 space-y-3">
              <input type="hidden" name="session_id" value={session.session_id} />
              <input type="hidden" name="date" value={returnDate} />
              {selectedResource ? (
                <input type="hidden" name="resource_id" value={selectedResource.resource_id} />
              ) : null}
              <PendingActionButton
                pendingLabel="Reservando…"
                className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-70"
              >
                {query.error ? "Intentar de nuevo" : "Confirmar reserva"}
              </PendingActionButton>
              <Link
                href={
                  session.requires_resource && selectedResource
                    ? `/student/reservar/${session.session_id}/recurso?date=${returnDate}`
                    : `/student/reservar/${session.session_id}?date=${returnDate}`
                }
                className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300"
              >
                Cancelar
              </Link>
            </form>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
            <p className="text-sm font-semibold text-amber-100">
              {bookingReasonCopy(session.eligibility?.reason_code)}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-zinc-400">
              La disponibilidad o tus condiciones cambiaron antes de confirmar. No se realizó
              ninguna reserva.
            </p>
            <Link
              href={`/student/reservar?date=${returnDate}`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-fuchsia-500/40 px-4 py-2.5 text-sm font-semibold text-fuchsia-200"
            >
              Volver a clases
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
