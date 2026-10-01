import Link from "next/link";

import { getStudentAccessContext } from "@/lib/student/portal";

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

type PurchaseKind = "package" | "package_enrollment" | "enrollment";

function statePresentation(
  status: string,
  outcome: Outcome,
  purchaseKind: PurchaseKind,
): Presentation {
  if (status === "approved") {
    if (purchaseKind === "enrollment") {
      return {
        tone: "emerald",
        eyebrow: "Pago confirmado",
        title: "¡Tu inscripción ya está activa!",
        description:
          "Mercado Pago confirmó el cobro y Studio Flow activó tu inscripción. No se agregó ningún paquete ni crédito extra.",
      };
    }
    if (purchaseKind === "package_enrollment") {
      return {
        tone: "emerald",
        eyebrow: "Pago confirmado",
        title: "¡Tu paquete y tu inscripción ya están listos!",
        description:
          "Mercado Pago confirmó el cobro y Studio Flow activó ambos conceptos. Ya puedes reservar tus clases.",
      };
    }
    return {
      tone: "emerald",
      eyebrow: "Pago confirmado",
      title: "¡Tu paquete ya está listo!",
      description:
        "Mercado Pago confirmó el cobro y Studio Flow activó tu paquete. Ya puedes reservar tus clases.",
    };
  }

  if (status === "pending") {
    return {
      tone: "amber",
      eyebrow: "Pago pendiente",
      title: "Tu pago sigue en proceso",
      description:
        "No realices otro pago. Volveremos a consultar a Mercado Pago cuando verifiques de nuevo o recibamos una actualización.",
    };
  }

  if (status === "rejected" || status === "cancelled") {
    return {
      tone: "rose",
      eyebrow: status === "rejected" ? "Pago rechazado" : "Pago cancelado",
      title:
        purchaseKind === "enrollment"
          ? "No se activó la inscripción"
          : purchaseKind === "package_enrollment"
            ? "No se activó el paquete ni la inscripción"
            : "No se activó ningún paquete",
      description:
        "El cobro no fue confirmado por Mercado Pago. Puedes regresar a Mi paquete e iniciar un nuevo intento cuando quieras.",
    };
  }

  if (status === "order_created" && outcome === "failure") {
    return {
      tone: "rose",
      eyebrow: "Pago no completado",
      title:
        purchaseKind === "enrollment"
          ? "No se activó la inscripción"
          : purchaseKind === "package_enrollment"
            ? "No se activó el paquete ni la inscripción"
            : "No se activó ningún paquete",
      description:
        "Mercado Pago te regresó desde un resultado no exitoso, pero todavía no publica un estado final verificable por API. Studio Flow no otorgará clases mientras eso ocurra.",
    };
  }

  if (status === "order_created" || outcome === "success" || outcome === "pending") {
    return {
      tone: "amber",
      eyebrow: "Confirmando pago",
      title: "Estamos verificando con Mercado Pago",
      description:
        "Tu regreso al portal no confirma por sí solo el pago. Studio Flow activará el paquete únicamente cuando Mercado Pago lo reporte como acreditado.",
    };
  }

  return {
    tone: "amber",
    eyebrow: "Verificación pendiente",
    title: "No pudimos confirmar el estado todavía",
    description:
      "No realices otro pago por ahora. Puedes verificar de nuevo o volver a Mi paquete; ningún crédito se activa sin confirmación del proveedor.",
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

export default async function StudentCheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string; outcome?: string }>;
}) {
  const [query, { supabase }] = await Promise.all([
    searchParams,
    getStudentAccessContext(),
  ]);
  const attemptId = query.attempt?.trim() ?? "";
  const outcome = safeOutcome(query.outcome);

  const { data: attempt } = attemptId
    ? await supabase
        .from("online_checkout_attempts")
        .select("product_template_id,extra_fulfillment_snapshot")
        .eq("id", attemptId)
        .eq("provider", "mercado_pago")
        .maybeSingle()
    : { data: null };
  const { data: purchasedProduct } = attempt?.product_template_id
    ? await supabase
        .from("product_templates")
        .select("product_type")
        .eq("id", attempt.product_template_id)
        .maybeSingle()
    : { data: null };
  const extraEnrollment =
    attempt?.extra_fulfillment_snapshot &&
    typeof attempt.extra_fulfillment_snapshot === "object" &&
    (attempt.extra_fulfillment_snapshot as { type?: unknown }).type === "enrollment";
  const purchaseKind: PurchaseKind =
    purchasedProduct?.product_type === "enrollment"
      ? "enrollment"
      : extraEnrollment
        ? "package_enrollment"
        : "package";

  let reconciliation: ReconcileResult = null;
  if (attemptId) {
    const { data } = await supabase.functions.invoke("reconcile-mercadopago-order", {
      body: { attemptId },
    });
    reconciliation = data as ReconcileResult;
  }

  const status = reconciliation?.ok ? (reconciliation.status ?? "unknown") : "unknown";
  const presentation = statePresentation(status, outcome, purchaseKind);
  const tone = toneClasses[presentation.tone];
  const refreshHref = attemptId
    ? `/student/paquete/checkout?attempt=${encodeURIComponent(attemptId)}${outcome ? `&outcome=${outcome}` : ""}`
    : "/student/paquete";

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <section
        className={`rounded-3xl border ${tone.border} ${tone.background} p-6 text-center sm:p-8`}
      >
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${tone.badge} text-3xl`}
        >
          {tone.icon}
        </div>
        <p className={`mt-5 text-sm font-semibold uppercase tracking-[0.2em] ${tone.text}`}>
          {presentation.eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{presentation.title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
          {presentation.description}
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Estado verificado
          </p>
          <p className="mt-2 text-sm font-medium text-white">
            {status === "approved"
              ? "Aprobado"
              : status === "pending"
                ? "Pendiente"
                : status === "rejected"
                  ? "Rechazado"
                  : status === "cancelled"
                    ? "Cancelado"
                    : status === "order_created"
                      ? "Aún sin resolución final"
                      : "Sin confirmación"}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Este estado se obtiene consultando Mercado Pago desde el servidor. Los parámetros de la
            URL nunca otorgan clases ni activan paquetes.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {status === "approved" ? (
            <Link
              href={purchaseKind === "enrollment" ? "/student/paquete" : "/student/reservar"}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              {purchaseKind === "enrollment" ? "Ver paquetes" : "Reservar una clase"}
            </Link>
          ) : status === "rejected" || status === "cancelled" ? (
            <Link
              href="/student/paquete"
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Intentar de nuevo
            </Link>
          ) : (
            <Link
              href={refreshHref}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Verificar de nuevo
            </Link>
          )}

          <Link
            href="/student/paquete"
            className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.05]"
          >
            Volver a Mi paquete
          </Link>
        </div>
      </section>
    </main>
  );
}
