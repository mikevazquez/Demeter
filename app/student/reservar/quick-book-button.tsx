"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bookStudentSessionInlineAction } from "@/app/student/actions";

import WaitlistControl from "./WaitlistControl";

const errorCopy: Record<string, string> = {
  booking_failed: "No pudimos crear la reserva. Revisa la clase e intenta de nuevo.",
  forbidden: "Tu cuenta no puede reservar esta clase.",
  session_not_found: "Esta clase ya no está disponible.",
  session_required: "No se pudo identificar la clase.",
  session_full: "La clase se llenó antes de completar tu reserva.",
  already_reserved: "Ya tienes un lugar reservado en esta clase.",
  no_active_product: "No tienes un paquete vigente para la fecha de esta clase.",
  outside_product: "Tu paquete no incluye esta disciplina.",
  no_credits: "No tienes créditos suficientes para reservar esta clase.",
  enrollment_required: "Necesitas una inscripción vigente para reservar.",
  session_not_bookable: "Esta clase ya no admite reservas.",
  student_not_operable: "Tu perfil no está habilitado para reservar en este momento.",
  resource_required: "Elige un recurso antes de confirmar tu reserva.",
  resource_full: "Ese recurso acaba de ocuparse. Elige otro lugar.",
  resource_not_available: "Ese recurso ya no está disponible. Elige otro lugar.",
};

type Props = {
  sessionId: string;
  activity: string;
  discipline: string;
  timeLabel: string;
  eligible: boolean;
  reserved: boolean;
  full?: boolean;
  waitlisted?: boolean;
  levelTitle?: string | null;
  requiresResource?: boolean;
};

export function QuickBookButton({
  sessionId,
  activity,
  discipline,
  timeLabel,
  eligible,
  reserved,
  full = false,
  waitlisted = false,
  levelTitle = null,
  requiresResource = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<
    { type: "success" } | { type: "error"; message: string } | null
  >(null);

  function reserve() {
    if (!eligible || reserved || isPending) return;

    if (requiresResource) {
      router.push(`/student/reservar/${sessionId}`);
      return;
    }

    startTransition(async () => {
      const result = await bookStudentSessionInlineAction(sessionId);
      if (!result.ok) {
        setModal({
          type: "error",
          message: errorCopy[result.error] ?? "No pudimos completar la reserva. Intenta de nuevo.",
        });
        router.refresh();
        return;
      }

      setModal({ type: "success" });
      router.refresh();
    });
  }

  function closeModal() {
    setModal(null);
  }

  return (
    <>
      {reserved ? (
        <span className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-200">
          Ya reservada
        </span>
      ) : eligible ? (
        <button
          type="button"
          onClick={reserve}
          disabled={isPending}
          className="min-h-11 rounded-2xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
        >
          {isPending ? "Reservando…" : "Reservar"}
        </button>
      ) : full ? (
        <WaitlistControl
          sessionId={sessionId}
          initialWaitlisted={waitlisted}
          levelTitle={levelTitle}
          compact
        />
      ) : null}

      {modal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-booking-title"
            className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl"
          >
            {modal.type === "success" ? (
              <>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-300">
                  ✓
                </div>
                <p className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Reserva confirmada
                </p>
                <h2
                  id="quick-booking-title"
                  className="mt-2 text-center text-2xl font-semibold text-white"
                >
                  ¡Tu lugar está listo!
                </h2>
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                    {discipline}
                  </p>
                  <p className="mt-1 font-semibold text-white">{activity}</p>
                  <p className="mt-1 text-sm text-zinc-400">{timeLabel}</p>
                </div>
                <p className="mt-4 text-center text-sm leading-6 text-zinc-400">
                  Puedes cerrar esta ventana y reservar otra clase del mismo día sin salir de la
                  agenda.
                </p>
              </>
            ) : (
              <>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 text-2xl text-rose-300">
                  !
                </div>
                <h2
                  id="quick-booking-title"
                  className="mt-4 text-center text-xl font-semibold text-white"
                >
                  No se pudo reservar
                </h2>
                <p className="mt-3 text-center text-sm leading-6 text-zinc-400">{modal.message}</p>
              </>
            )}

            <button
              type="button"
              onClick={closeModal}
              className="mt-6 w-full rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Cerrar
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
