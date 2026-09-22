import Link from "next/link";
import { notFound } from "next/navigation";

import {
  bookingReasonCopy,
  formatDateTime,
  formatMoney,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import PurchaseSingleClassButton from "../PurchaseSingleClassButton";
import WaitlistControl from "../WaitlistControl";

const DROP_IN_REASONS = new Set(["no_active_product", "outside_product", "no_credits"]);

type StudentWaitlistItem = {
  session_id: string;
  status: string;
};

type RewardStatusSnapshot = {
  level_title?: string | null;
};

type RewardPricePreview = {
  regular_amount_minor?: number;
  final_amount_minor?: number;
  discount_pct?: number;
  level_title?: string | null;
  eligible?: boolean;
};

export default async function StudentSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio, membership } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_session_detail", {
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const session = data as StudentSession;
  const { data: activityStyle } = await supabase
    .from("class_templates")
    .select("color_hex")
    .eq("studio_id", membership.studio_id)
    .eq("discipline_id", session.discipline_id)
    .eq("name", session.activity)
    .limit(1)
    .maybeSingle();
  const activityColor = activityStyle?.color_hex ?? "#FF0A8A";
  const [{ data: waitlistData }, { data: rewardStatusData }] = await Promise.all([
    supabase.rpc("student_waitlist_feed"),
    supabase.rpc("student_reward_status_snapshot"),
  ]);
  const waitlisted = ((waitlistData ?? []) as StudentWaitlistItem[]).some(
    (item) => item.session_id === session.session_id && item.status === "active",
  );
  const levelTitle = (rewardStatusData as RewardStatusSnapshot | null)?.level_title ?? null;
  const eligible = Boolean(session.eligibility?.eligible);
  const alreadyReserved = Boolean(session.reservation_id);
  const reason = session.eligibility?.reason_code;
  const sessionDate = localDateKey(new Date(session.starts_at), studio.timezone);
  const returnDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;
  const showDropIn =
    !eligible &&
    Boolean(reason && DROP_IN_REASONS.has(reason)) &&
    session.drop_in_price_minor != null;
  const { data: rewardPriceData } = showDropIn
    ? await supabase.rpc("student_reward_single_class_price", {
        target_session_id: session.session_id,
      })
    : { data: null };
  const rewardPrice = (rewardPriceData as RewardPricePreview | null) ?? null;
  const regularDropInMinor = rewardPrice?.regular_amount_minor ?? session.drop_in_price_minor ?? 0;
  const finalDropInMinor = rewardPrice?.final_amount_minor ?? regularDropInMinor;
  const rewardDiscountPct = rewardPrice?.discount_pct ?? 0;
  const rewardPriceLevelTitle = rewardPrice?.level_title ?? null;
  const durationMinutes = Math.max(
    Math.round(
      (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000,
    ),
    0,
  );

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href={`/student/reservar?date=${returnDate}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver a clases
      </Link>

      <section
        className="overflow-hidden rounded-3xl border bg-white/[0.03]"
        style={{ borderColor: `${activityColor}55` }}
      >
        <div
          className="p-5 sm:p-6"
          style={{
            background: `linear-gradient(135deg, ${activityColor}29 0%, rgba(255,255,255,0.035) 48%, transparent 100%)`,
          }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: activityColor }}
          >
            {session.discipline}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{session.activity}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {formatDateTime(session.starts_at, studio.timezone)}
            {durationMinutes ? ` · ${durationMinutes} min` : ""}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-white/10">
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Coach</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {session.coach ?? "Por confirmar"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Espacio</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {[session.location, session.space].filter(Boolean).join(" · ") || "Estudio"}
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Disponibilidad
            </dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {Math.max(session.capacity - session.spots_available, 0)} de {session.capacity}{" "}
              reservados
            </dd>
          </div>
          <div className="bg-[#111218] px-4 py-3">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Reserva</dt>
            <dd className="mt-1 text-xs font-semibold text-white">
              {session.eligibility?.unlimited
                ? "Incluida en ilimitado"
                : `${session.credit_cost} crédito${session.credit_cost === 1 ? "" : "s"}`}
            </dd>
          </div>
        </dl>

        {session.description ? (
          <div className="border-t border-white/10 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Sobre esta clase
            </p>
            <p className="mt-2 whitespace-pre-line text-xs leading-5 text-zinc-400">
              {session.description}
            </p>
          </div>
        ) : null}
      </section>

      {alreadyReserved ? (
        <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
          <p className="text-sm font-semibold text-emerald-200">✓ Ya tienes esta clase reservada</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Tu lugar está confirmado. Puedes consultar o gestionar esta reserva desde Mis clases.
          </p>
          <Link
            href="/student/mis-clases"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Ver Mis clases
          </Link>
        </section>
      ) : reason === "session_full" ? (
        <section className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.06] p-5">
          <p className="text-sm font-semibold text-amber-100">Esta clase está llena</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Puedes entrar a la lista de espera. La prioridad se aplica automáticamente según tu
            nivel vigente.
          </p>
          <div className="mt-4">
            <WaitlistControl
              sessionId={session.session_id}
              initialWaitlisted={waitlisted}
              levelTitle={levelTitle}
            />
          </div>
        </section>
      ) : eligible ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs leading-5 text-zinc-400">
            {session.eligibility?.unlimited
              ? "Esta clase está incluida en tu membresía ilimitada."
              : `Tienes ${session.eligibility?.available_credits ?? 0} crédito(s) disponibles. Esta reserva utiliza ${session.credit_cost}.`}
          </p>
          <Link
            href={
              session.requires_resource
                ? `/student/reservar/${session.session_id}/recurso?date=${returnDate}`
                : `/student/reservar/${session.session_id}/confirmar?date=${returnDate}`
            }
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            {session.requires_resource ? "Seleccionar recurso" : "Reservar clase"}
          </Link>
        </section>
      ) : (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <p className="text-sm font-semibold text-amber-100">{bookingReasonCopy(reason)}</p>
          {showDropIn ? (
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Clase suelta: {formatMoney(finalDropInMinor)} MXN.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Studio Flow está aplicando las condiciones vigentes de tu cuenta y paquete.
            </p>
          )}
          {showDropIn ? (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <Link
                href="/student/paquete"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Ver paquetes
              </Link>
              <PurchaseSingleClassButton
                sessionId={session.session_id}
                priceLabel={formatMoney(finalDropInMinor).replace(".00", "")}
                regularPriceLabel={formatMoney(regularDropInMinor).replace(".00", "")}
                discountPct={rewardDiscountPct}
                levelTitle={rewardPriceLevelTitle}
              />
            </div>
          ) : (
            <Link
              href="/student/paquete"
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Ver mi paquete
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
