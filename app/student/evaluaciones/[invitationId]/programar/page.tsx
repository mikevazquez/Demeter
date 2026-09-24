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
  localDateKey,
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

type EnrollmentRequirement = {
  required?: boolean;
  missing?: boolean;
  product_template_id?: string | null;
  name?: string | null;
  price_minor?: number | null;
  currency?: string | null;
  validity_days?: number | null;
};

const purchaseReasons = new Set([
  "no_active_product",
  "outside_product",
  "no_credits",
  "enrollment_required",
]);

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

function availabilityCopy(spotsAvailable: number) {
  if (spotsAvailable <= 0) return "Clase llena";
  if (spotsAvailable === 1) return "Último lugar";
  return `${spotsAvailable} lugares disponibles`;
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
  const { supabase, studio, membership, snapshot } = await getStudentPortalContext();

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
  let eligibleProductIds: string[] = [];
  let enrollmentRequirement: EnrollmentRequirement | null = null;

  if (needsPurchase && selectedSession) {
    const { data: enrollmentRequirementData } = await supabase.rpc(
      "student_enrollment_checkout_requirement",
      { target_session_id: selectedSession.session_id },
    );
    enrollmentRequirement = (enrollmentRequirementData as EnrollmentRequirement | null) ?? null;
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

    eligibleProductIds = [
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

  const selectedClassDate = selectedSession
    ? localDateKey(new Date(selectedSession.starts_at), studio.timezone)
    : null;
  const hasAccessForSelectedClass = Boolean(
    selectedSession &&
    selectedClassDate &&
    snapshot.acquisitions.some(
      (acquisition) =>
        acquisition.status === "active" &&
        acquisition.starts_on <= selectedClassDate &&
        acquisition.expires_on >= selectedClassDate &&
        eligibleProductIds.includes(acquisition.product_id) &&
        (acquisition.unlimited ||
          (acquisition.available_credits ?? 0) >= selectedSession.credit_cost),
    ),
  );
  const needsClassAccess = Boolean(needsPurchase && selectedSession && !hasAccessForSelectedClass);

  return (
    <main className="space-y-5 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Evaluaciones
      </Link>

      <header>
        <p className="student-eyebrow">{invitation.discipline_name}</p>
        <h1 className="student-page-title mt-1">¿En qué clase quieres hacer tu evaluación?</h1>
        <p className="student-body mt-2">
          Elige una clase dentro del periodo disponible. Tu evaluación se realizará durante esa
          clase.
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
            {needsPurchase
              ? needsClassAccess
                ? "Necesitas una clase disponible para programar tu evaluación"
                : enrollmentRequirement?.missing
                  ? "Necesitas una inscripción vigente"
                  : "Completa lo necesario para reservar"
              : "No pudimos programarla"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {needsPurchase
              ? needsClassAccess
                ? selectedSession?.drop_in_price_minor != null
                  ? "Puedes comprar esta clase o elegir un paquete para continuar."
                  : "Elige un paquete que incluya esta disciplina para continuar."
                : enrollmentRequirement?.missing
                  ? "Tu paquete sí tiene clases disponibles. La inscripción es el único requisito pendiente."
                  : errorMessage
              : errorMessage}
          </p>

          {needsPurchase && enrollmentRequirement?.missing ? (
            <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.055] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                    {needsClassAccess ? "Además · Inscripción requerida" : "Inscripción requerida"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {enrollmentRequirement.name ?? "Inscripción"}
                  </p>
                </div>
                {enrollmentRequirement.price_minor ? (
                  <strong className="text-sm text-white">
                    {formatMoney(
                      enrollmentRequirement.price_minor,
                      enrollmentRequirement.currency ?? "MXN",
                    )}
                  </strong>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {needsClassAccess
                  ? "No necesitas hacer una compra separada: se agregará al mismo pago de la clase o paquete que elijas."
                  : "Tu paquete se conserva. Solo necesitas completar la inscripción para reservar."}
              </p>

              {!needsClassAccess && enrollmentRequirement.product_template_id ? (
                <div className="mt-4">
                  <PurchasePackageButton
                    productTemplateId={enrollmentRequirement.product_template_id}
                    productName={enrollmentRequirement.name ?? "Inscripción"}
                    evaluationInvitationId={invitation.id}
                    evaluationSessionId={selectedSession?.session_id}
                    buttonLabel="Pagar inscripción"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {needsPurchase && selectedSession && needsClassAccess ? (
            <div className="mt-5 space-y-4">
              {selectedSession.drop_in_price_minor != null ? (
                <div className="rounded-2xl border border-fuchsia-500/25 bg-black/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">Comprar esta clase</p>
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">{selectedSession.drop_in_price_minor != null ? "Otra opción" : "Paquetes disponibles"}</p>
                <h3 className="mt-1 text-base font-semibold text-white">Comprar un paquete</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Elige un paquete válido para {invitation.discipline_name}. Después del pago,
                  continuaremos con esta misma evaluación.
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
                          <div className="mt-2">
                            <strong className="block text-sm text-white">
                              {formatMoney(
                                product.price_minor +
                                  (enrollmentRequirement?.missing
                                    ? (enrollmentRequirement.price_minor ?? 0)
                                    : 0),
                                product.currency,
                              )}
                            </strong>
                            {enrollmentRequirement?.missing && enrollmentRequirement.price_minor ? (
                              <span className="mt-0.5 block text-[10px] text-zinc-600">
                                Incluye {formatMoney(product.price_minor, product.currency)} del
                                paquete +{" "}
                                {formatMoney(
                                  enrollmentRequirement.price_minor,
                                  enrollmentRequirement.currency ?? product.currency,
                                )}{" "}
                                de inscripción
                              </span>
                            ) : null}
                          </div>
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
                    {[session.coach, session.space].filter(Boolean).join(" · ") || "Demeter"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <span>{availabilityCopy(session.spots_available)}</span>
                    <span>·</span>
                    <span>
                      {session.eligibility?.unlimited
                        ? "Incluida en tu paquete"
                        : String(session.credit_cost) +
                          " " +
                          (session.credit_cost === 1 ? "clase" : "clases") +
                          " de tu paquete"}
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
                        ? "Confirmar evaluación"
                        : reason && !purchaseReasons.has(reason)
                          ? "Revisar esta clase"
                          : "Elegir"}
                    </PendingActionButton>
                  </form>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 text-center">
            <p className="text-sm font-semibold text-white">No hay clases disponibles</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              No encontramos clases de {invitation.discipline_name} dentro de este periodo. Tu
              evaluación seguirá pendiente y podrás volver a revisar después.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
