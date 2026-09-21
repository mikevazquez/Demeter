import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PurchasePackageButton } from "@/app/student/paquete/purchase-package-button";
import PurchaseSingleClassButton from "@/app/student/reservar/PurchaseSingleClassButton";
import {
  bookingReasonCopy,
  formatDate,
  formatDateTime,
  formatMoney,
  getStudentPortalContext,
  type StudentSession,
} from "@/lib/student/portal";

import PendingActionButton from "../../../components/PendingActionButton";
import { scheduleEvaluationAction } from "../../actions";

type InvitationDetail = {
  id: string;
  discipline_id: string;
  discipline_name: string;
  invitation_kind: "first" | "periodic";
  status: string;
  window_start: string;
  window_end: string;
  reservation_id: string | null;
};

type RewardPricePreview = {
  regular_amount_minor?: number;
  final_amount_minor?: number;
  discount_pct?: number;
  level_title?: string | null;
};

type PurchasableProduct = {
  id: string;
  name: string;
  price_minor: number;
  currency: string;
  credit_limit: number | null;
  unlimited: boolean;
  validity_days: number | null;
};

const purchaseReasons = new Set(["no_active_product", "outside_product", "no_credits"]);

function errorCopy(value?: string) {
  const copy: Record<string, string> = {
    evaluation_invitation_not_schedulable: "Esta evaluación ya no está pendiente de programar.",
    evaluation_session_wrong_discipline: "La clase elegida no corresponde a esta disciplina.",
    evaluation_session_outside_window: "La clase elegida está fuera de la ventana de evaluación.",
    evaluation_schedule_failed: "No pudimos programar tu evaluación.",
    session_not_found: "La clase seleccionada ya no está disponible.",
    forbidden: "No puedes programar esta evaluación.",
  };
  return value ? (copy[value] ?? bookingReasonCopy(value)) : null;
}

function productBenefit(product: PurchasableProduct) {
  if (product.unlimited) return "Acceso ilimitado";
  if (product.credit_limit) return `${product.credit_limit} clases`;
  return "Paquete de clases";
}

export default async function ScheduleEvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ invitationId: string }>;
  searchParams: Promise<{ error?: string; session?: string }>;
}) {
  const { invitationId } = await params;
  const qs = await searchParams;
  const { supabase, studio, membership } = await getStudentPortalContext();

  const { data: invitationData, error: invitationError } = await supabase.rpc(
    "student_evaluation_invitation_detail",
    {
      p_invitation_id: invitationId,
    },
  );

  if (invitationError || !invitationData) notFound();

  const invitation = invitationData as InvitationDetail;

  if (invitation.status === "offered") {
    redirect("/student/evaluaciones/" + invitation.id);
  }

  if (invitation.status === "scheduled" || invitation.status === "in_progress") {
    redirect("/student/evaluaciones");
  }

  if (invitation.status !== "pending_schedule") {
    redirect("/student/evaluaciones");
  }

  const { data: scheduleData } = await supabase.rpc("student_schedule_feed", {
    target_start: invitation.window_start,
    target_end: invitation.window_end,
    target_discipline_id: invitation.discipline_id,
  });

  const sessions = (Array.isArray(scheduleData) ? scheduleData : []) as StudentSession[];
  const selectedSession = qs.session
    ? (sessions.find((session) => session.session_id === qs.session) ?? null)
    : null;
  const needsPurchase = Boolean(qs.error && purchaseReasons.has(qs.error));
  const errorMessage = errorCopy(qs.error);

  let rewardPrice: RewardPricePreview | null = null;
  let eligiblePackages: PurchasableProduct[] = [];

  if (needsPurchase && selectedSession) {
    if (selectedSession.drop_in_price_minor != null) {
      const { data: rewardPriceData } = await supabase.rpc("student_reward_single_class_price", {
        target_session_id: selectedSession.session_id,
      });
      rewardPrice = (rewardPriceData as RewardPricePreview | null) ?? null;
    }

    const { data: disciplineProductRows } = await supabase
      .from("product_template_disciplines")
      .select("product_template_id")
      .eq("studio_id", membership.studio_id)
      .eq("discipline_id", invitation.discipline_id);

    const eligibleProductIds = [
      ...new Set((disciplineProductRows ?? []).map((row) => row.product_template_id)),
    ];

    if (eligibleProductIds.length) {
      const { data: productRows } = await supabase
        .from("product_templates")
        .select("id,name,price_minor,currency,credit_limit,unlimited,validity_days")
        .eq("studio_id", membership.studio_id)
        .eq("active", true)
        .eq("online_purchasable", true)
        .in("product_type", ["package", "membership"])
        .in("id", eligibleProductIds)
        .order("price_minor", { ascending: true });

      eligiblePackages = (productRows ?? []) as PurchasableProduct[];
    }
  }

  const regularDropInMinor =
    rewardPrice?.regular_amount_minor ?? selectedSession?.drop_in_price_minor ?? 0;
  const finalDropInMinor = rewardPrice?.final_amount_minor ?? regularDropInMinor;

  return (
    <main className="space-y-5 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Evaluaciones
      </Link>

      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          {invitation.discipline_name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          Programar evaluación
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">
          Selecciona una clase real dentro de la ventana disponible. Tu reserva usa exactamente las
          mismas reglas, créditos y políticas que cualquier otra clase.
        </p>
      </header>

      <section className="rounded-3xl border border-fuchsia-500/25 bg-fuchsia-500/[0.055] p-4">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Ventana de evaluación
        </p>
        <strong className="mt-1 block text-sm text-white">
          Del {formatDate(invitation.window_start, studio.timezone)} al{" "}
          {formatDate(invitation.window_end, studio.timezone)}
        </strong>
      </section>

      {errorMessage ? (
        <section
          className={
            needsPurchase
              ? "rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06] p-5"
              : "rounded-3xl border border-rose-400/25 bg-rose-400/[0.06] p-5"
          }
        >
          <h2 className="text-lg font-semibold text-white">
            {needsPurchase ? "Elige cómo quieres acceder a esta clase" : "No pudimos programarla"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {needsPurchase
              ? "No tienes un paquete o crédito vigente para esta reserva. Puedes pagar sólo esta clase o comprar un paquete sin salir del flujo de tu evaluación."
              : errorMessage}
          </p>

          {needsPurchase && selectedSession ? (
            <div className="mt-5 space-y-4">
              {selectedSession.drop_in_price_minor != null ? (
                <div className="rounded-2xl border border-fuchsia-500/25 bg-black/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                        Opción 1
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white">Pagar esta clase</h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        Compra únicamente el acceso para la clase que elegiste.
                      </p>
                    </div>
                    <strong className="text-base text-white">
                      {formatMoney(finalDropInMinor)} MXN
                    </strong>
                  </div>
                  <div className="mt-4">
                    <PurchaseSingleClassButton
                      sessionId={selectedSession.session_id}
                      priceLabel={formatMoney(finalDropInMinor).replace(".00", "")}
                      regularPriceLabel={formatMoney(regularDropInMinor).replace(".00", "")}
                      discountPct={rewardPrice?.discount_pct ?? 0}
                      levelTitle={rewardPrice?.level_title ?? null}
                      evaluationInvitationId={invitation.id}
                      evaluationSessionId={selectedSession.session_id}
                    />
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                  {selectedSession.drop_in_price_minor != null ? "Opción 2" : "Comprar acceso"}
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">Comprar un paquete</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Elige un paquete válido para {invitation.discipline_name}. Al confirmar el pago,
                  Studio Flow intentará programar esta misma evaluación automáticamente.
                </p>

                {eligiblePackages.length ? (
                  <div className="mt-4 grid gap-2">
                    {eligiblePackages.map((product) => (
                      <article
                        key={product.id}
                        className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm text-white">{product.name}</strong>
                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-500">
                              {productBenefit(product)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {product.validity_days
                              ? `Vigencia: ${product.validity_days} días`
                              : "Vigencia según configuración del producto"}
                          </p>
                          <strong className="mt-2 block text-sm text-white">
                            {formatMoney(product.price_minor, product.currency)}
                          </strong>
                        </div>
                        <PurchasePackageButton
                          productTemplateId={product.id}
                          productName={product.name}
                          evaluationInvitationId={invitation.id}
                          evaluationSessionId={selectedSession.session_id}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl border border-white/10 px-4 py-3 text-xs text-zinc-500">
                    No hay paquetes online habilitados para esta disciplina en este momento.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        {sessions.length ? (
          sessions.map((session) => {
            const full = session.spots_available <= 0;
            const reason = session.eligibility?.reason_code ?? null;
            const alreadyReserved = Boolean(session.is_reserved);

            return (
              <article
                key={session.session_id}
                className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                    {formatDateTime(session.starts_at, studio.timezone)}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-white">{session.activity}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {[session.coach, session.space].filter(Boolean).join(" · ") || "Studio Flow"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                    <span>
                      {session.spots_available}/{session.capacity} lugares
                    </span>
                    <span>·</span>
                    <span>
                      {session.eligibility?.unlimited
                        ? "Incluida en ilimitado"
                        : String(session.credit_cost) +
                          " crédito" +
                          (session.credit_cost === 1 ? "" : "s")}
                    </span>
                  </div>
                </div>

                {full && !alreadyReserved ? (
                  <Link
                    href={"/student/reservar/" + session.session_id}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-amber-400/30 px-4 text-sm font-semibold text-amber-200"
                  >
                    Clase llena · Ver espera
                  </Link>
                ) : (
                  <form action={scheduleEvaluationAction}>
                    <input type="hidden" name="invitation_id" value={invitation.id} />
                    <input type="hidden" name="session_id" value={session.session_id} />
                    <PendingActionButton
                      pendingLabel="Programando…"
                      className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500 sm:w-auto"
                    >
                      {alreadyReserved
                        ? "Usar esta reserva"
                        : reason && !purchaseReasons.has(reason)
                          ? "Intentar reservar"
                          : "Seleccionar"}
                    </PendingActionButton>
                  </form>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 text-center">
            <p className="text-sm font-semibold text-white">No hay clases disponibles</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              No encontramos clases de {invitation.discipline_name} dentro de esta ventana. Tu
              evaluación seguirá pendiente.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
