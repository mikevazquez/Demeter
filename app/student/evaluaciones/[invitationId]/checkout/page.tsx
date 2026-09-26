import Link from "next/link";
import { notFound } from "next/navigation";

import { bookingReasonCopy, formatMoney, getStudentPortalContext } from "@/lib/student/portal";

type ReconcileResult = {
  ok?: boolean;
  status?: string;
  result?: string;
  error?: string;
} | null;

type InvitationDetail = {
  id: string;
  discipline_name: string;
  status: string;
};

type ScheduleResult = {
  eligible?: boolean;
  reason_code?: string | null;
  evaluation_status?: string;
  reservation_id?: string;
} | null;

type Outcome = "success" | "failure" | "pending" | null;

function safeOutcome(value: string | undefined): Outcome {
  return value === "success" || value === "failure" || value === "pending" ? value : null;
}

export default async function EvaluationCheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ invitationId: string }>;
  searchParams: Promise<{ attempt?: string; outcome?: string; session?: string }>;
}) {
  const { invitationId } = await params;
  const query = await searchParams;
  const attemptId = query.attempt?.trim() ?? "";
  const sessionId = query.session?.trim() ?? "";
  const outcome = safeOutcome(query.outcome);
  const { supabase, studio } = await getStudentPortalContext();

  const { data: invitationData, error: invitationError } = await supabase.rpc(
    "student_evaluation_invitation_detail",
    { p_invitation_id: invitationId },
  );

  if (invitationError || !invitationData || !attemptId || !sessionId) notFound();

  const invitation = invitationData as InvitationDetail;

  let reconciliation: ReconcileResult = null;
  const { data: reconcileData } = await supabase.functions.invoke("reconcile-mercadopago-order", {
    body: { attemptId },
  });
  reconciliation = reconcileData as ReconcileResult;

  const { data: attempt } = await supabase
    .from("online_checkout_attempts")
    .select("id,product_name_snapshot,amount_minor,currency,status,session_id")
    .eq("id", attemptId)
    .eq("provider", "mercado_pago")
    .maybeSingle();

  if (!attempt) notFound();

  const attemptWithExtra = attempt as
    (typeof attempt & { extra_fulfillment_snapshot?: unknown }) | null;
  const extraSnapshot = attemptWithExtra?.extra_fulfillment_snapshot;
  const extraFulfillment =
    extraSnapshot && typeof extraSnapshot === "object" && !Array.isArray(extraSnapshot)
      ? (extraSnapshot as {
          name?: string;
          price_minor?: number;
          currency?: string;
        })
      : null;

  const status = reconciliation?.ok
    ? (reconciliation.status ?? attempt.status ?? "unknown")
    : (attempt.status ?? "unknown");

  let scheduleResult: ScheduleResult = null;
  let scheduleError: string | null = null;

  if (status === "approved" && invitation.status === "pending_schedule") {
    const { data, error } = await supabase.rpc("student_schedule_evaluation", {
      p_invitation_id: invitationId,
      p_session_id: sessionId,
    });
    scheduleResult = data as ScheduleResult;
    scheduleError = error?.message ?? null;
  }

  const scheduled =
    invitation.status === "scheduled" ||
    scheduleResult?.evaluation_status === "scheduled" ||
    Boolean(scheduleResult?.reservation_id);

  const rejected = status === "rejected" || status === "cancelled";
  const pending = !scheduled && !rejected && status !== "approved";
  const bookingReason =
    scheduleResult?.reason_code ??
    (scheduleError?.includes("session_full") ? "session_full" : null) ??
    (status === "approved" && !scheduled ? "booking_failed" : null);

  const backToScheduling =
    "/student/evaluaciones/" +
    encodeURIComponent(invitationId) +
    "/programar" +
    (sessionId ? "?session=" + encodeURIComponent(sessionId) : "");

  const refreshHref =
    "/student/evaluaciones/" +
    encodeURIComponent(invitationId) +
    "/checkout?attempt=" +
    encodeURIComponent(attemptId) +
    "&session=" +
    encodeURIComponent(sessionId) +
    (outcome ? "&outcome=" + outcome : "");

  return (
    <main className="mx-auto max-w-2xl space-y-5 pb-4">
      <section
        className={
          "rounded-3xl border p-6 text-center sm:p-8 " +
          (scheduled
            ? "border-emerald-500/25 bg-emerald-500/[0.07]"
            : rejected
              ? "border-rose-500/25 bg-rose-500/[0.07]"
              : status === "approved"
                ? "border-amber-400/25 bg-amber-400/[0.07]"
                : "border-violet-400/25 bg-violet-400/[0.07]")
        }
      >
        <div
          className={
            "mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl " +
            (scheduled
              ? "bg-emerald-500/15 text-emerald-300"
              : rejected
                ? "bg-rose-500/15 text-rose-300"
                : status === "approved"
                  ? "bg-amber-400/15 text-amber-300"
                  : "bg-violet-400/15 text-violet-300")
          }
        >
          {scheduled ? "✓" : rejected ? "!" : "…"}
        </div>

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
          {invitation.discipline_name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          {scheduled
            ? "Evaluación programada"
            : rejected
              ? "Pago no completado"
              : status === "approved"
                ? "Pago confirmado"
                : "Confirmando tu pago"}
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
          {scheduled
            ? "Tu compra quedó acreditada y Studio Flow reservó automáticamente la clase que elegiste para tu evaluación."
            : rejected
              ? "No se activó ningún acceso. Puedes intentarlo nuevamente sin perder tu evaluación."
              : status === "approved"
                ? "Tu compra quedó acreditada, pero no pudimos reservar esa clase automáticamente. Tu crédito o paquete permanece activo para que elijas otra opción."
                : "Estamos verificando el pago con Mercado Pago. No realices otro pago mientras siga pendiente."}
        </p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Compra
          </p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-white">{attempt.product_name_snapshot}</span>
              <span className="text-xs text-zinc-500">Acceso</span>
            </div>
            {extraFulfillment?.name && extraFulfillment.price_minor ? (
              <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] pt-2">
                <span className="text-sm text-white">{extraFulfillment.name}</span>
                <span className="text-xs text-zinc-500">
                  {formatMoney(
                    extraFulfillment.price_minor,
                    extraFulfillment.currency ?? attempt.currency,
                  )}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2">
              <strong className="text-xs uppercase tracking-[0.12em] text-zinc-500">Total</strong>
              <strong className="text-sm text-white">
                {formatMoney(attempt.amount_minor, attempt.currency, studio.locale)}
              </strong>
            </div>
          </div>
        </div>

        {status === "approved" && !scheduled && bookingReason ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-left">
            <p className="text-xs font-semibold text-amber-200">La compra sí quedó activa.</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              {bookingReasonCopy(bookingReason)} Elige otra clase disponible para completar la
              programación.
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {scheduled ? (
            <Link
              href="/student/evaluaciones"
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Ver mis evaluaciones
            </Link>
          ) : rejected || status === "approved" ? (
            <Link
              href={backToScheduling}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Volver a elegir clase
            </Link>
          ) : (
            <Link
              href={refreshHref}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Verificar de nuevo
            </Link>
          )}

          {!scheduled ? (
            <Link
              href="/student/evaluaciones"
              className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.05]"
            >
              Volver a Evaluaciones
            </Link>
          ) : null}
        </div>

        {pending ? (
          <p className="mt-4 text-[11px] text-zinc-600">
            Studio Flow sólo reservará la clase cuando Mercado Pago confirme el cobro.
          </p>
        ) : null}
      </section>
    </main>
  );
}
