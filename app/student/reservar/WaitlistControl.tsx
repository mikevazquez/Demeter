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
};

export default function WaitlistControl({
  sessionId,
  initialWaitlisted = false,
  levelTitle = null,
  compact = false,
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
    <div className={compact ? "text-right" : ""}>
      <button
        type="button"
        onClick={join}
        disabled={isPending}
        className="min-h-11 rounded-2xl border border-fuchsia-500/45 bg-fuchsia-500/[0.07] px-4 py-2.5 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/[0.13] disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Uniéndote…" : "Unirme a lista de espera"}
      </button>
      {error ? <p className="mt-2 max-w-sm text-xs leading-5 text-rose-300">{error}</p> : null}
    </div>
  );
}
