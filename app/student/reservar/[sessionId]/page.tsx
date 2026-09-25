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
import { BookingRestrictionCard } from "../BookingRestrictionCard";

const DROP_IN_REASONS = new Set(["no_active_product", "outside_product", "no_credits"]);

type StudentWaitlistItem = {
  session_id: string;
  status: string;
};

type RewardPricePreview = {
  regular_amount_minor?: number;
  final_amount_minor?: number;
  discount_pct?: number;
  level_title?: string | null;
  eligible?: boolean;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function availabilityCopy(spotsAvailable: number) {
  if (spotsAvailable <= 0) return "Clase llena";
  if (spotsAvailable === 1) return "Último lugar";
  return `${spotsAvailable} lugares disponibles`;
}

export default async function StudentSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string; credit?: string; discipline?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const rewardMode = query.credit === "reward";
  const rewardSuffix = rewardMode ? "&credit=reward" : "";
  const disciplineSuffix =
    query.discipline && /^[0-9a-f-]{36}$/i.test(query.discipline)
      ? `&discipline=${query.discipline}`
      : "";
  const returnSuffix = `${rewardSuffix}${disciplineSuffix}`;
  const { supabase, studio, membership, snapshot } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_session_detail", {
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const session = data as StudentSession;
  const [{ data: activityStyle }, { data: sessionMeta }, { data: disciplineMeta }] =
    await Promise.all([
    supabase
      .from("class_templates")
      .select("*")
      .eq("studio_id", membership.studio_id)
      .eq("discipline_id", session.discipline_id)
      .eq("name", session.activity)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("class_sessions")
      .select("*")
      .eq("studio_id", membership.studio_id)
      .eq("id", session.session_id)
      .maybeSingle(),
    supabase
      .from("disciplines")
      .select("*")
      .eq("studio_id", membership.studio_id)
      .eq("id", session.discipline_id)
      .maybeSingle(),
  ]);
  const activityColor = activityStyle?.color_hex ?? "#FF0A8A";
  const sessionImagePath =
    sessionMeta && typeof sessionMeta.cover_image_path === "string"
      ? sessionMeta.cover_image_path
      : null;
  const activityImagePath =
    activityStyle && typeof activityStyle.cover_image_path === "string"
      ? activityStyle.cover_image_path
      : null;
  const disciplineImagePath =
    disciplineMeta && typeof disciplineMeta.cover_image_path === "string"
      ? disciplineMeta.cover_image_path
      : null;
  const coverImagePath = sessionImagePath ?? activityImagePath ?? disciplineImagePath;
  const coverImageUrl = coverImagePath
    ? supabase.storage.from("class-artwork").getPublicUrl(coverImagePath).data.publicUrl
    : null;
  const { data: waitlistData } = await supabase.rpc("student_waitlist_feed");
  const waitlisted = ((waitlistData ?? []) as StudentWaitlistItem[]).some(
    (item) => item.session_id === session.session_id && item.status === "active",
  );
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
  const activePackage =
    snapshot.acquisitions.find((item) => item.active_now && !item.reward_credit_wallet) ?? null;
  const giftClassesAvailable = snapshot.acquisitions
    .filter((item) => item.active_now && item.reward_credit_wallet && item.status === "active")
    .reduce((total, item) => total + (item.available_credits ?? 0), 0);

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href={`/student/reservar?date=${returnDate}${returnSuffix}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver a clases
      </Link>

      {rewardMode ? (
        <section className="rounded-2xl border border-emerald-400/35 bg-emerald-400/[0.07] px-4 py-3">
          <p className="text-sm font-semibold text-emerald-200">Usar una clase extra</p>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Si confirmas esta reserva, utilizaremos una de tus clases extra disponibles.
          </p>
        </section>
      ) : null}

      <section
        className="overflow-hidden rounded-[1.7rem] border bg-[#0f1118]"
        style={{ borderColor: `${activityColor}66` }}
      >
        <div
          className="relative min-h-[300px] p-5 sm:min-h-[360px] sm:p-6"
          style={{
            background: coverImageUrl
              ? `linear-gradient(180deg, rgba(7,8,12,.08) 10%, rgba(7,8,12,.78) 88%), url("${coverImageUrl}") center / cover`
              : `radial-gradient(circle at 78% 24%, ${activityColor}77, transparent 30%), linear-gradient(145deg, ${activityColor}38, #0b0d13 68%)`,
          }}
        >
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
            <span
              className="inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
              style={{
                borderColor: `${activityColor}88`,
                backgroundColor: `${activityColor}33`,
                color: "#fff",
              }}
            >
              {session.discipline}
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {session.activity} ✨
            </h1>
            <p className="mt-2 text-sm text-zinc-200">
              {formatDateTime(session.starts_at, studio.timezone)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 sm:p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-3">
            <p className="text-xs text-zinc-500">Coach</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">
              {session.coach ?? "Por confirmar"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-3">
            <p className="text-xs text-zinc-500">Duración</p>
            <p className="mt-1 text-sm font-semibold text-white">{durationMinutes} min</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-3">
            <p className="text-xs text-zinc-500">Espacio</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">
              {[session.location, session.space].filter(Boolean).join(" · ") || "Estudio"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-3">
            <p className="text-xs text-zinc-500">Disponibilidad</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {availabilityCopy(session.spots_available)}
            </p>
          </div>
        </div>

        {session.description ? (
          <div className="border-t border-white/10 px-5 py-4">
            <p className="text-xs font-semibold text-zinc-500">Sobre esta clase</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-300">
              {session.description}
            </p>
          </div>
        ) : null}
      </section>

      {activePackage || giftClassesAvailable > 0 ? (
        <section className="relative overflow-hidden rounded-[1.5rem] border border-fuchsia-400/30 bg-[radial-gradient(circle_at_85%_20%,rgba(255,10,138,.22),transparent_35%),linear-gradient(145deg,#261023,#121018)] p-5">
          <div className="relative">
            <p className="text-xs font-semibold text-fuchsia-200">Mi paquete 🎁</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {activePackage?.unlimited
                ? "Clases ilimitadas"
                : activePackage
                  ? `${activePackage.available_credits ?? 0} clases disponibles`
                  : "Clases extra disponibles"}
            </h2>
            {giftClassesAvailable > 0 ? (
              <p className="mt-2 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-xs font-semibold text-emerald-200">
                🎁 {giftClassesAvailable}{" "}
                {giftClassesAvailable === 1 ? "clase de regalo" : "clases de regalo"}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-zinc-400">
              {rewardMode
                ? `Esta reserva usará ${session.credit_cost} ${session.credit_cost === 1 ? "clase extra" : "clases extra"}.`
                : session.eligibility?.unlimited
                  ? "Esta clase está incluida en tu paquete ilimitado."
                  : `Esta reserva utiliza ${session.credit_cost} ${session.credit_cost === 1 ? "clase" : "clases"}.`}
            </p>
          </div>
        </section>
      ) : null}

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
          <p className="mt-1.5 text-sm leading-6 text-zinc-400">
            Puedes entrar a la lista de espera. Si se libera un lugar, te avisaremos según el orden
            de prioridad.
          </p>
          <div className="mt-4">
            <WaitlistControl sessionId={session.session_id} initialWaitlisted={waitlisted} />
          </div>
        </section>
      ) : eligible ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs leading-5 text-zinc-400">
            {rewardMode
              ? `Esta reserva utilizará ${session.credit_cost} ${session.credit_cost === 1 ? "clase extra" : "clases extra"}.`
              : session.eligibility?.unlimited
                ? "Esta clase está incluida en tu paquete ilimitado."
                : `Tienes ${session.eligibility?.available_credits ?? 0} clases disponibles. Esta reserva utiliza ${session.credit_cost}.`}
          </p>
          <Link
            href={
              session.requires_resource
                ? `/student/reservar/${session.session_id}/recurso?date=${returnDate}${rewardSuffix}`
                : `/student/reservar/${session.session_id}/confirmar?date=${returnDate}${rewardSuffix}`
            }
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            {session.requires_resource ? "Elegir mi lugar" : "Reservar esta clase"}
          </Link>
        </section>
      ) : (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          {session.eligibility?.restrictions?.length ? (
            <BookingRestrictionCard
              restrictions={session.eligibility.restrictions}
              compact
              returnTo={`/student/reservar/${session.session_id}?date=${returnDate}${rewardSuffix}`}
            />
          ) : (
            <p className="text-sm font-semibold text-amber-100">{bookingReasonCopy(reason)}</p>
          )}
          {showDropIn ? (
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Clase suelta: {formatMoney(finalDropInMinor)} MXN.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Revisa la razón indicada arriba para saber qué necesitas resolver antes de reservar.
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
          ) : session.eligibility?.restrictions?.length ? null : (
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
