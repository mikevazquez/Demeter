"use server";

import Image from "next/image";
import Link from "next/link";

import {
  getStudentPortalContext,
  localDateKey,
  type StudentAcquisition,
} from "@/lib/student/portal";

import StudentNoticeDialog from "./components/StudentNoticeDialog";

type RewardLevelView = {
  key?: string;
  title?: string;
};

type RewardLevelDefinitionRow = RewardLevelView & {
  level_key: string;
  level_order: number;
  waitlist_priority?: number | null;
  private_discount_pct?: number | null;
  event_discount_pct?: number | null;
  monthly_guest_invites?: number | null;
};

type RewardStatusSnapshot = {
  access_unlocked?: boolean;
  current_medal?: RewardLevelView | null;
  current_level?: RewardLevelView | null;
};

type AppNotificationHomeItem = {
  id: string;
  title: string;
  body: string;
  notification_type: string;
};

type BookingRestriction = {
  title: string;
  detail?: string | null;
  action_href?: string | null;
  action_label?: string | null;
};

type EvaluationHomeCard = {
  invitation_id: string | null;
  invitation_status: "offered" | "pending_schedule" | "scheduled" | "in_progress" | null;
  discipline_name: string;
};

type StudentEvaluationsHomeSnapshot = {
  disciplines?: EvaluationHomeCard[];
};

type RewardOnboardingHomeRow = {
  documents_completed_at: string | null;
  profile_completed_at: string | null;
  app_installed_at: string | null;
  notifications_enabled_at: string | null;
  first_reservation_at: string | null;
  first_attendance_at: string | null;
  access_unlocked_at: string | null;
};

const urgentNotificationTypes = new Set([
  "session_minimum_cancelled",
  "class_cancelled_student",
  "class_rescheduled",
  "waitlist_promoted",
]);

function availableClasses(activePackage: StudentAcquisition | null) {
  if (!activePackage || activePackage.unlimited) return null;
  return activePackage.available_credits ?? 0;
}

function todayLabel(dateKey: string) {
  const value = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${dateKey}T12:00:00Z`))
    .replace(".", "");

  return `Hoy ${value}.`;
}

function timeOnly(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function MedalArtwork({
  medalKey = "bronze",
  className = "",
}: {
  medalKey?: string | null;
  className?: string;
}) {
  const palette =
    medalKey === "gold"
      ? ["#ffe08a", "#d99a23", "#7c4511"]
      : medalKey === "silver"
        ? ["#f4f6fb", "#9ca5b3", "#505967"]
        : ["#ffc06d", "#cd7f32", "#6e3418"];

  return (
    <span aria-hidden="true" className={`relative block shrink-0 ${className}`}>
      <span className="absolute left-[34%] top-0 h-[31%] w-[20%] rounded bg-fuchsia-500" />
      <span className="absolute left-[50%] top-0 h-[31%] w-[20%] rounded bg-[#211421]" />
      <span
        className="absolute left-[16%] top-[25%] flex h-[68%] w-[68%] items-center justify-center rounded-full border-2 text-[34%] font-bold shadow-[0_0_28px_rgba(255,10,138,.18)]"
        style={{
          borderColor: palette[0],
          color: palette[0],
          background: `radial-gradient(circle at 38% 30%, ${palette[0]}, ${palette[1]} 56%, ${palette[2]})`,
        }}
      >
        ★
      </span>
    </span>
  );
}

function priorityNotificationTone(type: string) {
  if (type === "class_rescheduled" || type === "waitlist_promoted") {
    return "border-amber-400/30 bg-amber-400/[0.055] text-amber-100";
  }

  return "border-rose-400/30 bg-rose-400/[0.055] text-rose-100";
}

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();

  const [
    rewardStatusResult,
    rewardMembershipResult,
    rewardLevelsResult,
    appNotificationsResult,
    bookingRestrictionsResult,
    evaluationsResult,
    rewardOnboardingResult,
  ] = await Promise.all([
    supabase.rpc("student_reward_status_snapshot"),
    supabase
      .from("reward_status_memberships")
      .select("current_level_key")
      .eq("studio_id", membership.studio_id)
      .eq("student_id", snapshot.profile.student_id)
      .maybeSingle(),
    supabase
      .from("reward_status_level_definitions")
      .select(
        "level_key,level_order,title,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites",
      )
      .eq("studio_id", membership.studio_id)
      .order("level_order"),
    supabase
      .from("app_notifications")
      .select("id,title,body,notification_type")
      .eq("student_id", snapshot.profile.student_id)
      .eq("recipient_kind", "student")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.rpc("student_booking_restrictions_snapshot", { p_session_id: null }),
    supabase.rpc("student_evaluations_snapshot"),
    supabase
      .from("reward_onboarding")
      .select(
        "documents_completed_at,profile_completed_at,app_installed_at,notifications_enabled_at,first_reservation_at,first_attendance_at,access_unlocked_at",
      )
      .eq("studio_id", membership.studio_id)
      .eq("student_id", snapshot.profile.student_id)
      .maybeSingle(),
  ]);

  const rewardStatus = (rewardStatusResult.data as RewardStatusSnapshot | null) ?? null;
  const levelDefinitions = (rewardLevelsResult.data ?? []) as RewardLevelDefinitionRow[];
  const fallbackLevelKey = rewardMembershipResult.data?.current_level_key ?? null;
  const fallbackLevel =
    levelDefinitions.find((level) => level.level_key === fallbackLevelKey) ?? null;
  const rewardOnboarding = (rewardOnboardingResult.data as RewardOnboardingHomeRow | null) ?? null;
  const onboardingSteps = [
    rewardOnboarding?.documents_completed_at,
    rewardOnboarding?.profile_completed_at,
    rewardOnboarding?.app_installed_at,
    rewardOnboarding?.notifications_enabled_at,
    rewardOnboarding?.first_reservation_at,
    rewardOnboarding?.first_attendance_at,
  ];
  const onboardingCompleted = onboardingSteps.filter(Boolean).length;
  const onboardingPercent = Math.round((onboardingCompleted / onboardingSteps.length) * 100);
  const rewardsUnlocked = Boolean(
    rewardStatus?.access_unlocked || rewardOnboarding?.access_unlocked_at,
  );
  const currentMedal = rewardsUnlocked
    ? (rewardStatus?.current_medal ?? rewardStatus?.current_level ?? fallbackLevel)
    : null;
  const currentMedalKey = rewardsUnlocked
    ? (currentMedal?.key ?? fallbackLevel?.level_key ?? "bronze")
    : null;
  const medalTitle = rewardsUnlocked
    ? (currentMedal?.title ?? fallbackLevel?.title ?? "Bronce")
    : "Bronce";

  const unreadNotifications = (appNotificationsResult.data ?? []) as AppNotificationHomeItem[];
  const priorityNotification =
    unreadNotifications.find((item) => urgentNotificationTypes.has(item.notification_type)) ?? null;
  const primaryRestriction =
    ((bookingRestrictionsResult.data ?? []) as BookingRestriction[])[0] ?? null;

  const evaluationsSnapshot =
    (evaluationsResult.data as StudentEvaluationsHomeSnapshot | null) ?? null;
  const activeEvaluationInvitation =
    evaluationsSnapshot?.disciplines?.find(
      (item) =>
        item.invitation_id &&
        (item.invitation_status === "offered" || item.invitation_status === "pending_schedule"),
    ) ?? null;
  const evaluationHref = activeEvaluationInvitation?.invitation_id
    ? activeEvaluationInvitation.invitation_status === "offered"
      ? `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}`
      : `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}/programar`
    : "/student/evaluaciones";

  const packageAcquisitions = snapshot.acquisitions.filter((item) => !item.reward_credit_wallet);
  const giftClassWallets = snapshot.acquisitions.filter(
    (item) => item.reward_credit_wallet && item.active_now && item.status === "active",
  );
  const activePackage = packageAcquisitions.find((item) => item.active_now) ?? null;
  const classesAvailable = availableClasses(activePackage);
  const giftClassesAvailable = giftClassWallets.reduce(
    (total, item) => total + (item.available_credits ?? 0),
    0,
  );
  const packageAvailablePercent =
    activePackage && !activePackage.unlimited && activePackage.credit_limit
      ? Math.min(100, Math.round(((classesAvailable ?? 0) / activePackage.credit_limit) * 100))
      : 0;

  const sortedUpcoming = [...snapshot.upcoming].sort(
    (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
  );
  const nextClass = sortedUpcoming[0] ?? null;
  const today = localDateKey(new Date(), studio.timezone);

  const activeLevelDefinition =
    levelDefinitions.find((level) => level.level_key === currentMedalKey) ?? fallbackLevel;
  const bronzeLevelDefinition =
    levelDefinitions.find((level) => level.level_key === "bronze") ?? null;
  const benefitLevel = rewardsUnlocked ? activeLevelDefinition : bronzeLevelDefinition;
  const benefitItems = [
    benefitLevel?.waitlist_priority
      ? {
          title: "Lista de espera",
          detail: rewardsUnlocked ? "Prioridad activa en clases llenas." : "Disponible con Bronce.",
          icon: "👥",
        }
      : null,
    (benefitLevel?.private_discount_pct ?? 0) > 0
      ? {
          title: "Privados",
          detail: `${benefitLevel?.private_discount_pct}% de descuento.`,
          icon: "🏋️",
        }
      : null,
    (benefitLevel?.event_discount_pct ?? 0) > 0
      ? {
          title: "Talleres",
          detail: `${benefitLevel?.event_discount_pct}% de descuento.`,
          icon: "★",
        }
      : null,
    (benefitLevel?.monthly_guest_invites ?? 0) > 0
      ? {
          title: "Invitaciones",
          detail: `${benefitLevel?.monthly_guest_invites} al mes.`,
          icon: "✦",
        }
      : null,
  ].filter(
    (item): item is { title: string; detail: string; icon: string } => Boolean(item),
  );

  const medalImageSrc =
    currentMedalKey === "diamond"
      ? "/student/diamond-medal.jpg"
      : currentMedalKey === "bronze"
        ? "/student/home/bronze-medal.jpg"
        : null;

  return (
    <main className="w-full px-4 pb-28 pt-[18px] sm:mx-auto sm:max-w-[430px] lg:pt-0">
      {query.cancelled ? (
        <StudentNoticeDialog
          eyebrow="Reserva actualizada"
          title="Tu reserva fue cancelada"
          dismissHref="/student"
        >
          La clase ya no aparece entre tus próximas reservas.
        </StudentNoticeDialog>
      ) : query.error ? (
        <StudentNoticeDialog
          eyebrow="No pudimos completar la acción"
          title="Revisa tu reserva"
          dismissHref="/student"
          tone="error"
        >
          No pudimos completar la cancelación. Revisa la clase e intenta nuevamente.
        </StudentNoticeDialog>
      ) : null}

      <div className="flex h-6 items-center gap-3 pl-1.5 lg:hidden">
        <span aria-hidden="true" className="text-[20px] font-semibold leading-6 text-[#ff0a8a]">
          ✿
        </span>
        <span className="text-[15px] font-semibold leading-[18px] tracking-[0.27em] text-[#f7f8fb]">
          D E M E T E R
        </span>
      </div>

      <section className="mt-3 flex h-[50px] items-center gap-3 pl-1.5 pr-1 lg:mt-0">
        <Link
          href="/student/perfil"
          aria-label="Abrir mi perfil"
          className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#ff55c0] bg-[#261424] text-lg font-semibold text-white shadow-[0_0_0_3px_rgba(255,10,138,.08)]"
        >
          <span aria-hidden="true">{snapshot.profile.first_name.slice(0, 1).toUpperCase()}</span>
          <Image src="/student/perfil/avatar" alt="" fill unoptimized className="object-cover" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-bold leading-[29px] tracking-[-0.03em] text-[#f7f8fb]">
            Hola, {snapshot.profile.first_name} 👋
          </h1>
          <p className="truncate text-[14px] leading-[17px] text-[#9aa3b2]">{todayLabel(today)}</p>
        </div>

        <Link
          href="/student/reservar"
          aria-label="Buscar una clase"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-[#5a405f] bg-[#171824] text-[#f7f8fb]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
        </Link>
      </section>

      {priorityNotification ? (
        <Link
          href={`/student/notificaciones/${priorityNotification.id}`}
          data-home-block="priority-action"
          className={`mt-3 block rounded-2xl border p-4 ${priorityNotificationTone(
            priorityNotification.notification_type,
          )}`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">Necesita tu atención</p>
          <h2 className="mt-1 text-base font-semibold text-white">{priorityNotification.title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{priorityNotification.body}</p>
        </Link>
      ) : primaryRestriction ? (
        <section
          data-home-block="priority-action"
          className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.055] p-4"
        >
          <p className="text-xs font-semibold text-amber-200">Necesitas resolver esto</p>
          <h2 className="mt-1 text-base font-semibold text-white">{primaryRestriction.title}</h2>
          {primaryRestriction.detail ? (
            <p className="mt-1 text-sm leading-6 text-zinc-300">{primaryRestriction.detail}</p>
          ) : null}
          {primaryRestriction.action_href ? (
            <Link
              href={primaryRestriction.action_href}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
            >
              {primaryRestriction.action_label || "Resolver"}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section
        data-home-block="next-class"
        className="relative mt-[19px] h-[174px] overflow-hidden rounded-[24px] border border-[rgba(247,103,220,.55)] bg-[#351334] shadow-[0_14px_40px_rgba(255,10,138,.12)]"
      >
        <Image
          src="/student/home/hero-forms.jpg"
          alt=""
          width={370}
          height={355}
          priority
          className="absolute -right-2 -top-1 h-[178px] w-[184px] object-cover"
        />
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-[34%] w-[37%] bg-[linear-gradient(90deg,rgba(52,18,51,.96)_0%,rgba(74,18,69,.52)_58%,rgba(74,18,69,0)_100%)]"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(31,10,31,.97)_0%,rgba(67,17,62,.74)_48%,rgba(255,10,138,.06)_100%)]"
        />

        <div className="relative z-10 h-full px-[18px] pt-[18px]">
          <p className="text-[11px] font-semibold tracking-[0.26em] text-[#ffb2e4]">
            {nextClass ? "TU PRÓXIMA CLASE" : "TU PRÓXIMO PASO"}
          </p>

          {nextClass ? (
            <>
              <h2 className="mt-2 max-w-[220px] truncate text-[30px] font-bold leading-9 tracking-[-0.035em] text-white">
                {nextClass.activity} ✨
              </h2>
              <div className="mt-2 flex max-w-[245px] items-center gap-2 text-[15px] font-semibold text-white">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 18 18"
                  fill="none"
                  className="h-[18px] w-[18px] shrink-0 text-[#ff5ab4]"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <rect x="2.5" y="4.5" width="13" height="11" rx="2" />
                  <path d="M5.5 2.5v4M12.5 2.5v4M3 8h12" />
                </svg>
                <span className="truncate">
                  {timeOnly(nextClass.starts_at, studio.timezone)}–
                  {timeOnly(nextClass.ends_at, studio.timezone)}
                  {nextClass.space ? ` · ${nextClass.space}` : ""}
                </span>
              </div>
              <div className="mt-[14px] flex max-w-[250px] items-center gap-[10px] text-[11px] leading-[14px] text-[#f7f8fb]">
                <span
                  aria-hidden="true"
                  className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#ff40b3] text-[17px] font-bold text-[#090a0f]"
                >
                  ✓
                </span>
                <span className="min-w-0 truncate">
                  {nextClass.coach ? `Coach ${nextClass.coach}` : "Coach por confirmar"}
                  <span aria-hidden="true"> · </span>
                  Tu lugar está confirmado
                </span>
              </div>
            </>
          ) : activePackage ? (
            <>
              <h2 className="mt-2 max-w-[220px] text-[28px] font-bold leading-8 tracking-[-0.03em] text-white">
                Reserva tu próxima clase ✨
              </h2>
              <p className="mt-4 max-w-[220px] text-[11px] leading-[15px] text-[#ece0ef]">
                {activePackage.unlimited
                  ? "Tu paquete ilimitado está listo."
                  : `Tienes ${classesAvailable ?? 0} clases disponibles.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-2 max-w-[220px] text-[28px] font-bold leading-8 tracking-[-0.03em] text-white">
                Activa tu paquete 🎁
              </h2>
              <p className="mt-4 max-w-[220px] text-[11px] leading-[15px] text-[#ece0ef]">
                Elige un paquete para comenzar a reservar.
              </p>
            </>
          )}
        </div>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-[10px]">
        <Link
          href="/student/reservar"
          className="flex h-[50px] items-center justify-center gap-3 rounded-[25px] bg-[#ff3fb0] text-[15px] font-semibold text-[#090a0f]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 22 22"
            fill="none"
            className="h-[22px] w-[22px]"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <rect x="3" y="5" width="16" height="14" rx="2.5" />
            <path d="M7 3v4M15 3v4M3 9h16" />
          </svg>
          Reservar
        </Link>
        <Link
          href="/student/mis-clases"
          className="flex h-[50px] items-center justify-center gap-3 rounded-[25px] border border-[#a32b7d] bg-[#17131d] text-[14px] font-semibold text-white"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 22 22"
            fill="none"
            className="h-[22px] w-[22px] text-[#ff49b4]"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M4 7a3 3 0 0 0 3 3 3 3 0 0 0-3 3v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a3 3 0 0 0-3-3 3 3 0 0 0 3-3V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2Z" />
          </svg>
          <span>Ver mis clases</span>
          <span aria-hidden="true" className="text-xl">›</span>
        </Link>
      </div>

      <section className="mt-[17px]">
        <h2 className="text-[27px] font-bold leading-[34px] tracking-[-0.035em] text-[#f7f8fb]">
          Lo importante para ti
        </h2>

        <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
          <Link
            href="/student/paquete"
            data-home-block="package"
            className="relative h-[168px] overflow-hidden rounded-[24px] border border-[#eadfff] bg-[linear-gradient(145deg,#e4d8ff_0%,#c1aaf7_100%)] px-[14px] pt-[14px] text-[#140d19]"
          >
            <p className="truncate pr-8 text-[16px] font-bold leading-5">Mi paquete 🎁</p>
            <span
              aria-hidden="true"
              className="absolute right-[11px] top-[10px] flex h-7 w-7 items-center justify-center rounded-full bg-white/55 text-[22px]"
            >
              ›
            </span>

            {activePackage?.unlimited ? (
              <p className="mt-3 text-[25px] font-semibold">Ilimitado</p>
            ) : activePackage ? (
              <div className="mt-[7px] flex items-end gap-2">
                <strong className="text-[31px] font-bold leading-8">{classesAvailable ?? 0}</strong>
                <span className="pb-[2px] text-[14px] font-semibold">disponibles</span>
              </div>
            ) : (
              <p className="mt-3 text-[19px] font-semibold">Sin paquete</p>
            )}

            {activePackage && !activePackage.unlimited && activePackage.credit_limit ? (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/55">
                  <div
                    className="h-full rounded-full bg-[#ff2da6]"
                    style={{ width: `${packageAvailablePercent}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-[#615272]">
                  {classesAvailable ?? 0} de {activePackage.credit_limit} clases
                </p>
              </>
            ) : (
              <p className="mt-3 text-[10px] text-[#615272]">
                {activePackage ? "Sin límite de clases" : "Activa uno para reservar"}
              </p>
            )}

            <div
              className={`absolute inset-x-[11px] bottom-[10px] flex h-9 items-center justify-between rounded-[14px] px-3 text-[10.5px] font-semibold ${
                giftClassesAvailable > 0
                  ? "bg-[#ff9ed2] text-[#a50d60]"
                  : "bg-white/30 text-[#665b75]"
              }`}
            >
              <span className="truncate">
                🎁{" "}
                {giftClassesAvailable > 0
                  ? `+${giftClassesAvailable} clases de regalo`
                  : "Sin clases de regalo"}
              </span>
              <span aria-hidden="true" className="text-lg">›</span>
            </div>
          </Link>

          <Link
            href={rewardsUnlocked ? "/student/recompensas/medallero" : "/student/recompensas"}
            data-home-block="medal"
            className="relative h-[168px] overflow-hidden rounded-[24px] border border-[#51475c] bg-[linear-gradient(145deg,#291629_0%,#15141d_58%,#0e0e14_100%)] px-[12px] pt-[13px]"
          >
            {rewardsUnlocked ? (
              <>
                <p className="pr-8 text-[12px] font-semibold leading-4 text-white">Medalla actual 🏅</p>
                <p className="mt-3 max-w-[102px] truncate text-[19px] font-semibold text-white">
                  {medalTitle}
                </p>
                <p className="mt-2 max-w-[94px] text-[10px] leading-[13px] text-[#b7adbe]">
                  Por tu constancia
                  <br />y progreso
                </p>
                {medalImageSrc ? (
                  <Image
                    src={medalImageSrc}
                    alt=""
                    width={80}
                    height={94}
                    className="absolute bottom-0 right-0 h-[88px] w-[72px] object-cover"
                  />
                ) : (
                  <MedalArtwork
                    medalKey={currentMedalKey}
                    className="absolute bottom-2 right-1 h-[72px] w-[72px]"
                  />
                )}
                <span aria-hidden="true" className="absolute right-4 top-3 text-xl text-white">
                  ›
                </span>
              </>
            ) : (
              <>
                <p className="pr-7 text-[11px] font-semibold leading-4 text-white">
                  Tu primera medalla 🏅
                </p>
                <p className="mt-[7px] text-[12px] leading-4 text-[#e7d8ec]">Desbloquea Bronce</p>
                <div
                  className="mt-[10px] h-2 w-[104px] overflow-hidden rounded-full bg-white/15"
                  role="progressbar"
                  aria-label="Progreso para desbloquear Bronce"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={onboardingPercent}
                >
                  <div
                    className="h-full rounded-full bg-[#ff36aa]"
                    style={{ width: `${onboardingPercent}%` }}
                  />
                </div>
                <p className="mt-1 max-w-[112px] whitespace-nowrap text-[9px] text-[#c7b8cf]">
                  {onboardingCompleted} de {onboardingSteps.length} pasos completados
                </p>
                <span className="absolute bottom-[12px] left-[12px] inline-flex h-8 items-center rounded-full border border-[#ad2f87] bg-[#3d203b] px-4 text-[10px] font-semibold text-[#ffabe0]">
                  Ver pasos&nbsp;&nbsp;›
                </span>
                <Image
                  src="/student/home/bronze-medal.jpg"
                  alt=""
                  width={80}
                  height={96}
                  className="absolute bottom-0 right-0 h-[94px] w-[60px] object-cover"
                />
                <span aria-hidden="true" className="absolute right-4 top-3 text-xl text-white">
                  ›
                </span>
              </>
            )}
          </Link>

          <Link
            href={evaluationHref}
            data-home-block="evaluation"
            className="relative h-[168px] overflow-hidden rounded-[24px] border border-[#9f2b79] bg-[linear-gradient(145deg,#4a1843_0%,#251625_65%,#17141d_100%)] p-[14px]"
          >
            <p className="text-[17px] font-bold leading-5 text-white">Evaluación</p>
            <span
              aria-hidden="true"
              className="absolute right-[10px] top-[10px] flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xl"
            >
              ›
            </span>
            <div className="mt-[12px] flex items-start gap-[10px]">
              <span
                aria-hidden="true"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] border border-[#ff84d2]/50 bg-[#74366d]/60 text-[21px]"
              >
                ▤
              </span>
              <strong className="pt-1 text-[13px] leading-[15px] text-white">
                {activeEvaluationInvitation ? (
                  <>
                    Diagnóstico
                    <br />pendiente
                  </>
                ) : (
                  <>
                    Evaluaciones
                    <br />al día
                  </>
                )}
              </strong>
            </div>
            <p className="mt-[7px] text-[10px] leading-[13px] text-[#c8becd]">
              {activeEvaluationInvitation
                ? "Conoce tu progreso y recibe recomendaciones personalizadas."
                : "Consulta tu nivel técnico y próximos ciclos."}
            </p>
            <span className="absolute inset-x-[14px] bottom-[10px] flex h-7 items-center justify-between rounded-full border border-[#dd3a9e] bg-[#43203f] px-4 text-[10px] font-semibold text-[#ffb1e1]">
              {activeEvaluationInvitation ? "▣  Agendar" : "Ver progreso"}
              <span aria-hidden="true">›</span>
            </span>
          </Link>

          <Link
            href="/student/recompensas/medallero"
            data-home-block="benefits"
            className="relative h-[168px] overflow-hidden rounded-[24px] border border-[#55445b] bg-[linear-gradient(145deg,#321b2c_0%,#19161f_70%,#12131a_100%)] p-[14px]"
          >
            <p className="text-[17px] font-bold leading-5 text-white">Beneficios</p>
            <span
              aria-hidden="true"
              className="absolute right-[10px] top-[10px] flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xl"
            >
              ›
            </span>

            {benefitItems.length ? (
              <div className="mt-[11px] space-y-[8px]">
                {benefitItems.slice(0, 3).map((benefit) => (
                  <div key={benefit.title} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border border-[#ff40ad] text-[11px] text-[#ff55b8]"
                    >
                      {benefit.icon}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[10px] font-semibold leading-3 text-white">
                        {benefit.title}
                      </strong>
                      <span className="block truncate text-[7.5px] leading-[10px] text-[#b8adbe]">
                        {benefit.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-8 pr-3">
                <p className="text-[12px] font-semibold text-white">
                  {rewardsUnlocked ? "Tus beneficios aparecerán aquí" : "Desbloquéalos con Bronce"}
                </p>
                <p className="mt-2 text-[9px] leading-3 text-[#b8adbe]">
                  Tu medalla define los beneficios disponibles para ti.
                </p>
              </div>
            )}
          </Link>
        </div>
      </section>
    </main>
  );
}
