import Link from "next/link";

import { formatMoney, getStudentPortalContext } from "@/lib/student/portal";

type ReconcileResult = {
  ok?: boolean;
  status?: string;
  result?: string;
  failureCode?: string | null;
  error?: string;
} | null;

type Outcome = "success" | "failure" | "pending" | null;

function safeOutcome(value: string | undefined): Outcome {
  return value === "success" || value === "failure" || value === "pending" ? value : null;
}

export default async function SingleClassCheckoutReturnPage({
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

  const { data: attempt } = attemptId
    ? await supabase
        .from("online_checkout_attempts")
        .select("id,session_id,product_name_snapshot,amount_minor,status")
        .eq("id", attemptId)
        .eq("provider", "mercado_pago")
        .maybeSingle()
    : { data: null };

  const status = reconciliation?.ok ? (reconciliation.status ?? attempt?.status ?? "unknown") : (attempt?.status ?? "unknown");
  const sessionHref = attempt?.session_id
    ? `/student/reservar/${encodeURIComponent(attempt.session_id)}`
    : "/student/reservar";
  const refreshHref = attemptId
    ? `/student/reservar/checkout?attempt=${encodeURIComponent(attemptId)}${outcome ? `&outcome=${outcome}` : ""}`
    : "/student/reservar";

  const approved = status === "approved";
  const rejected = status === "rejected" || status === "cancelled";

  return (
    <main className="mx-auto max-w-2xl space-y-6 pb-4">
      <section
        className={`rounded-3xl border p-6 text-center sm:p-8 ${
          approved
            ? "border-emerald-500/20 bg-emerald-500/[0.08]"
            : rejected
              ? "border-rose-500/20 bg-rose-500/[0.08]"
              : "border-amber-500/20 bg-amber-500/[0.08]"
        }`}
      >
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
            approved
              ? "bg-emerald-500/15 text-emerald-300"
              : rejected
                ? "bg-rose-500/15 text-rose-300"
                : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {approved ? "✓" : rejected ? "!" : "…"}
        </div>

        <p
          className={`mt-5 text-sm font-semibold uppercase tracking-[0.2em] ${
            approved ? "text-emerald-300" : rejected ? "text-rose-300" : "text-amber-300"
          }`}
        >
          {approved ? "Pago confirmado" : rejected ? "Pago no completado" : "Confirmando pago"}
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-white">
          {approved
            ? "Tu clase suelta ya está disponible"
            : rejected
              ? "No se realizó la compra"
              : "Estamos verificando con Mercado Pago"}
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
          {approved
            ? "El pago fue acreditado y Studio Flow agregó el crédito para esta actividad. Ahora reserva tu lugar en la clase."
            : rejected
              ? "No se activó ningún crédito. Puedes volver a la clase e intentarlo nuevamente."
              : "No realices otro pago por ahora. Studio Flow activará la clase únicamente cuando Mercado Pago confirme el cobro."}
        </p>

        {attempt ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Compra
            </p>
            <p className="mt-2 text-sm font-medium text-white">{attempt.product_name_snapshot}</p>
            <p className="mt-1 text-xs text-zinc-400">{formatMoney(attempt.amount_minor)} MXN</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {approved ? (
            <Link
              href={sessionHref}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Reservar mi lugar
            </Link>
          ) : rejected ? (
            <Link
              href={sessionHref}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Volver a la clase
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
            Ver paquetes
          </Link>
        </div>
      </section>
    </main>
  );
}
