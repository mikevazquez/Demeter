"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { joinStudentWaitlistInlineAction } from "@/app/student/actions";

const errorCopy: Record<string, string> = {
  session_required: "No se pudo identificar la clase.",
  session_not_found: "Esta clase ya no está disponible.",
  session_not_bookable: "Esta clase ya no admite lista de espera.",
  already_reserved: "Ya tienes un lugar reservado en esta clase.",
  seat_available: "Se liberó un lugar. Actualiza para reservarlo directamente.",
  enrollment_required: "Necesitas una inscripción vigente para entrar a la lista.",
  no_active_product: "Necesitas un paquete vigente para entrar a la lista.",
  outside_product: "Tu paquete no incluye esta disciplina.",
  no_credits: "Necesitas créditos disponibles para entrar a la lista.",
  payment_pending: "Tu paquete tiene un pago pendiente.",
  student_not_operable: "Tu perfil no está habilitado para reservar en este momento.",
};

type Props = {
  sessionId: string;
  initialWaitlisted?: boolean;
  levelTitle?: string | null;
  compact?: boolean;
  variant?: "default" | "tile";
};

export default function WaitlistControl({
  sessionId,
  initialWaitlisted = false,
  levelTitle = null,
  compact = false,
  variant = "default",
}: Props) {
  const router = useRouter();
  const [waitlisted, setWaitlisted] = useState(initialWaitlisted);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const priorityLabel =
    levelTitle === "Oro" || levelTitle === "Diamante" ? `Prioridad ${levelTitle} aplicada` : null;

  function join() {
    if (waitlisted || isPending) return;

    setError(null);
    startTransition(async () => {
      const result = await joinStudentWaitlistInlineAction(sessionId);

      if (!result.ok) {
        setError(errorCopy[result.error] ?? "No pudimos unirte a la lista de espera.");
        router.refresh();
        return;
      }

      setWaitlisted(true);
      router.refresh();
    });
  }

  if (waitlisted) {
    if (variant === "tile") {
      return (
        <span
          aria-live="polite"
          className="relative flex min-h-16 min-w-0 items-center justify-center self-stretch rounded-[14px] border border-amber-400/30 bg-amber-400/[0.09] px-2 text-center text-xs font-semibold text-amber-200"
        >
          En espera
        </span>
      );
    }
    return (
      <div className={compact ? "space-y-1.5 text-right" : "space-y-2"}>
        <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/[0.09] px-3 py-1.5 text-xs font-semibold text-amber-200">
          En lista de espera
        </span>
        {priorityLabel ? (
          <p className="text-[11px] font-semibold text-amber-100">{priorityLabel}</p>
        ) : null}
        <p className="text-[11px] leading-5 text-zinc-400">Te avisaremos si se libera un lugar.</p>
        <p className="text-[10px] text-zinc-600">La prioridad no garantiza lugar.</p>
      </div>
    );
  }

  return (
    <div
      className={
        variant === "tile"
          ? "relative flex min-w-0 flex-col self-stretch"
          : compact
            ? "text-right"
            : ""
      }
    >
      <button
        type="button"
        onClick={join}
        disabled={isPending}
        className={
          variant === "tile"
            ? "min-h-16 w-full min-w-0 flex-1 self-stretch rounded-[14px] border border-fuchsia-500/45 bg-fuchsia-500/[0.07] px-2 text-center text-[11px] font-semibold leading-tight text-fuchsia-100 transition hover:bg-fuchsia-500/[0.13] disabled:cursor-wait disabled:opacity-60"
            : "min-h-11 rounded-2xl border border-fuchsia-500/45 bg-fuchsia-500/[0.07] px-4 py-2.5 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/[0.13] disabled:cursor-wait disabled:opacity-60"
        }
      >
        <span className={variant === "tile" ? "block text-[11px] leading-tight" : undefined}>
          {isPending ? "Uniéndote…" : "Unirme a lista de espera"}
        </span>
      </button>
      {error ? (
        <p role="alert" className="mt-2 max-w-sm text-xs leading-5 text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
