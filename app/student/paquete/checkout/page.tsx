import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";

type ReconcileResult = {
  ok?: boolean;
  status?: string;
  result?: string;
  failureCode?: string | null;
  error?: string;
} | null;

type Outcome = "success" | "failure" | "pending" | null;
type Tone = "emerald" | "amber" | "rose";

type Presentation = {
  tone: Tone;
  eyebrow: string;
  title: string;
  description: string;
};

function safeOutcome(value: string | undefined): Outcome {
  return value === "success" || value === "failure" || value === "pending" ? value : null;
}

function statePresentation(status: string, outcome: Outcome): Presentation {
  if (status === "approved") {
    return {
      tone: "emerald",
      eyebrow: "Pago confirmado",
      title: "Tu paquete ya está activo",
      description: "Ya puedes usar tus clases y hacer una nueva reserva.",
    };
  }

  if (status === "pending") {
    return {
      tone: "amber",
      eyebrow: "Confirmando pago",
      title: "Estamos confirmando tu pago",
      description: "Normalmente tarda solo unos momentos. No necesitas volver a pagar.",
    };
  }

  if (status === "rejected" || status === "cancelled") {
    return {
      tone: "rose",
      eyebrow: "Pago no completado",
      title: "El pago no se completó",
      description: "No activamos un paquete. Puedes intentarlo nuevamente cuando quieras.",
    };
  }

  if (status === "order_created" && outcome === "failure") {
    return {
      tone: "amber",
      eyebrow: "Verificación pendiente",
      title: "Todavía no podemos confirmar tu pago",
      description:
        "No realices otro pago por ahora. Revisa el estado antes de volver a intentarlo.",
    };
  }

  if (status === "order_created" || outcome === "success" || outcome === "pending") {
    return {
      tone: "amber",
      eyebrow: "Confirmando pago",
      title: "Estamos confirmando tu pago",
      description: "No necesitas volver a pagar. Actualiza el estado en unos momentos.",
    };
  }

  return {
    tone: "amber",
    eyebrow: "Verificación pendiente",
    title: "Todavía no podemos confirmar tu pago",
    description: "No realices otro pago por ahora. Puedes revisar el estado nuevamente.",
  };
}

const toneClasses = {
  emerald: {
    border: "border-emerald-500/20",
    background: "bg-emerald-500/[0.08]",
    badge: "bg-emerald-500/15 text-emerald-300",
    text: "text-emerald-300",
    icon: "✓",
  },
  amber: {
    border: "border-amber-500/20",
    background: "bg-amber-500/[0.08]",
    badge: "bg-amber-500/15 text-amber-300",
    text: "text-amber-300",
    icon: "…",
  },
  rose: {
    border: "border-rose-500/20",
    background: "bg-rose-500/[0.08]",
    badge: "bg-rose-500/15 text-rose-300",
    text: "text-rose-300",
    icon: "!",
  },
} as const;

function statusCopy(status: string) {
  if (status === "approved") return "Confirmado";
  if (status === "pending" || status === "order_created") return "Pendiente";
  if (status === "rejected") return "Rechazado";
  if (status === "cancelled") return "Cancelado";
  return "Por confirmar";
}

export default async function StudentCheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string; outcome?: string }>;
}) {
  const query = await searchParams;
  const attemptId = query.attempt?.trim() ?? "";
  const outcome = safeOutcome(query.outcome);
  const { supabase } = await getStudentPortalContext();

  let reconciliation: ReconcileResult = null;
  if (attemptId) {
    const { data } = await supabase.functions.invoke("reconcile-mercadopago-order", {
      body: { attemptId },
    });
    reconciliation = data as ReconcileResult;
  }

  const status = reconciliation?.ok ? (reconciliation.status ?? "unknown") : "unknown";
  const presentation = statePresentation(status, outcome);
  const tone = toneClasses[presentation.tone];
  const refreshHref = attemptId
    ? `/student/paquete/checkout?attempt=${encodeURIComponent(attemptId)}${outcome ? `&outcome=${outcome}` : ""}`
    : "/student/paquete";

  return (
    <main className="mx-auto max-w-xl space-y-5 pb-6">
      <section
        className={`rounded-3xl border ${tone.border} ${tone.background} p-6 text-center sm:p-8`}
      >
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${tone.badge} text-3xl`}
        >
          {tone.icon}
        </div>

        <p className={`mt-5 text-xs font-semibold uppercase tracking-[0.16em] ${tone.text}`}>
          {presentation.eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{presentation.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">
          {presentation.description}
        </p>

        <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <p className="text-xs text-zinc-500">Estado del pago</p>
          <p className="mt-1 text-sm font-semibold text-white">{statusCopy(status)}</p>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {status === "approved" ? (
            <Link href="/student/reservar" className="student-action-primary w-full sm:w-auto">
              Reservar una clase
            </Link>
          ) : status === "rejected" || status === "cancelled" ? (
            <Link href="/student/paquete" className="student-action-primary w-full sm:w-auto">
              Intentar nuevamente
            </Link>
          ) : (
            <Link href={refreshHref} className="student-action-primary w-full sm:w-auto">
              Actualizar estado
            </Link>
          )}

          <Link href="/student/paquete" className="student-action-secondary w-full sm:w-auto">
            Ver mi paquete
          </Link>
        </div>
      </section>
    </main>
  );
}
