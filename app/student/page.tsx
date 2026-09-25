import Image from "next/image";
import Link from "next/link";

import {
  formatDateTime,
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

function addDays(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarChip(value: string) {
  const date = new Date(value + "T12:00:00Z");

  return {
    weekday: new Intl.DateTimeFormat("es-MX", {
      weekday: "short",
      timeZone: "UTC",
    })
      .format(date)
      .replace(".", ""),
    day: new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      timeZone: "UTC",
    }).format(date),
  };
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

function dateOnly(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "short",
  })
    .format(new Date(value))
    .replace(".", "");
}

function MedalArtwork({
  medalKey = "bronze",
  dimmed = false,
  className = "",
}: {
  medalKey?: string | null;
  dimmed?: boolean;
  className?: string;
}) {
  const palette =
    medalKey === "gold"
      ? ["#ffe08a", "#d99a23", "#7c4511"]
      : medalKey === "silver"
        ? ["#f4f6fb", "#9ca5b3", "#505967"]
        : medalKey === "diamond"
          ? ["#c7f5ff", "#65cde7", "#28768c"]
          : ["#ffc06d", "#cd7f32", "#6e3418"];
  const center = medalKey === "diamond" ? "◆" : "★";

  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 ${className}`}
      style={{ opacity: dimmed ? 0.48 : 1 }}
    >
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
        {center}
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
      .select("level_key,level_order,title")
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
  const rewardOnboarding =
    (rewardOnboardingResult.data as RewardOnboardingHomeRow | null) ?? null;
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
    : "Por activar";

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
      ? Math.min(
          100,
          Math.round(((classesAvailable ?? 0) / activePackage.credit_limit) * 100),
        )
      : 0;

  const sortedUpcoming = [...snapshot.upcoming].sort(
    (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
  );
  const nextClass = sortedUpcoming[0] ?? null;

  const artworkSessionIds = nextClass ? [nextClass.session_id] : [];
  const artworkActivityNames = nextClass ? [nextClass.activity] : [];
  const [{ data: artworkSessionRows }, { data: artworkTemplateRows }] = await Promise.all([
    artworkSessionIds.length
      ? supabase
          .from("class_sessions")
          .select("*")
          .eq("studio_id", membership.studio_id)
          .in("id", artworkSessionIds)
      : Promise.resolve({ data: [] }),
    artworkActivityNames.length
      ? supabase
          .from("class_templates")
          .select("*")
          .eq("studio_id", membership.studio_id)
          .in("name", artworkActivityNames)
      : Promise.resolve({ data: [] }),
  ]);

  const sessionArtworkPath =
    artworkSessionRows?.[0] && typeof artworkSessionRows[0].cover_image_path === "string"
      ? artworkSessionRows[0].cover_image_path
      : null;
  const activityArtworkPath =
    artworkTemplateRows?.[0] && typeof artworkTemplateRows[0].cover_image_path === "string"
      ? artworkTemplateRows[0].cover_image_path
      : null;
  const nextClassArtworkPath = sessionArtworkPath ?? activityArtworkPath;
  const nextClassArtworkUrl = nextClassArtworkPath
    ? supabase.storage.from("class-artwork").getPublicUrl(nextClassArtworkPath).data.publicUrl
    : null;

  const today = localDateKey(new Date(), studio.timezone);
  const calendarDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 3));
  const upcomingDates = new Set(
    sortedUpcoming.map((item) => localDateKey(new Date(item.starts_at), studio.timezone)),
  );
  const nextClassDate = nextClass
    ? localDateKey(new Date(nextClass.starts_at), studio.timezone)
    : null;

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pb-28 pt-[18px] lg:px-0 lg:pt-0">
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
          className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#583965] bg-[#261424] text-lg font-semibold text-white shadow-[0_0_0_3px_rgba(255,10,138,.08)]"
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
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-[#171a24] text-[#f7f8fb]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="h-[22px] w-[22px]"
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
      ) : activeEvaluationInvitation?.invitation_id ? (
        <section
          data-home-block="priority-action"
          className="mt-3 rounded-2xl border border-violet-400/25 bg-violet-400/[0.055] p-4"
        >
          <p className="text-xs font-semibold text-violet-200">Evaluación disponible ✨</p>
          <h2 className="mt-1 text-base font-semibold text-white">
            {activeEvaluationInvitation.discipline_name}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Tienes una acción pendiente en tu nivel técnico.
          </p>
          <Link
            href={
              activeEvaluationInvitation.invitation_status === "offered"
                ? `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}`
                : `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}/programar`
            }
            className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
          >
            {activeEvaluationInvitation.invitation_status === "offered"
              ? "Ver evaluación"
              : "Elegir mi clase"}
          </Link>
        </section>
      ) : null}

      <Link
        href={
          nextClass
            ? "/student/mis-clases"
            : activePackage
              ? "/student/reservar"
              : "/student/paquete"
        }
        data-home-block="next-class"
        className="relative mt-[19px] block h-[174px] overflow-hidden rounded-[24px] border border-[rgba(247,103,220,.55)] bg-[#371337]"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-[38%] bg-cover bg-center opacity-95"
          style={{
            backgroundImage: `url("${nextClassArtworkUrl ?? "/student/home-hero-fallback.jpg"}")`,
          }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(30,11,31,.98)_0%,rgba(83,20,76,.72)_62%,rgba(255,10,138,.18)_100%)]"
        />

        <div className="relative z-10 h-full">
          <p className="absolute left-[18px] top-[18px] text-[11px] font-semibold leading-[13px] tracking-[0.28em] text-[#ff94e0]">
            {nextClass ? "T U  P R Ó X I M A  C L A S E" : "T U  P R Ó X I M O  P A S O"}
          </p>

          {nextClass ? (
            <>
              <h2 className="absolute left-[18px] top-[48px] max-w-[245px] truncate text-[31px] font-bold leading-[38px] tracking-[-0.035em] text-[#f7f8fb]">
                {nextClass.activity} ✨
              </h2>
              <p className="absolute left-[18px] top-[91px] max-w-[245px] truncate text-[17px] font-semibold leading-[21px] text-[#f7f8fb]">
                {timeOnly(nextClass.starts_at, studio.timezone)}
                {nextClass.space ? ` · ${nextClass.space}` : ""}
              </p>
              <p className="absolute left-[18px] top-[128px] max-w-[315px] truncate text-[11px] leading-[14px] text-[#ece0ef]">
                ● {nextClass.coach ? `Coach ${nextClass.coach} · ` : ""}Tu lugar está confirmado
              </p>
            </>
          ) : activePackage ? (
            <>
              <h2 className="absolute left-[18px] top-[50px] max-w-[245px] text-[27px] font-bold leading-8 tracking-[-0.03em] text-[#f7f8fb]">
                Reserva tu próxima clase ✨
              </h2>
              <p className="absolute left-[18px] top-[125px] max-w-[255px] text-[11px] leading-[15px] text-[#ece0ef]">
                {activePackage.unlimited
                  ? "Tu paquete ilimitado está listo."
                  : `Tienes ${classesAvailable ?? 0} clases disponibles.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="absolute left-[18px] top-[50px] max-w-[245px] text-[27px] font-bold leading-8 tracking-[-0.03em] text-[#f7f8fb]">
                Activa tu paquete 🎁
              </h2>
              <p className="absolute left-[18px] top-[125px] max-w-[255px] text-[11px] leading-[15px] text-[#ece0ef]">
                Elige un paquete para comenzar a reservar.
              </p>
            </>
          )}
        </div>
      </Link>

      <nav aria-label="Tu semana" className="mt-3 flex h-[70px] items-stretch justify-between gap-1.5">
        {calendarDays.map((dateKey) => {
          const chip = calendarChip(dateKey);
          const isToday = dateKey === today;
          const weekday = chip.weekday.charAt(0).toUpperCase() + chip.weekday.slice(1, 3);

          return (
            <Link
              key={dateKey}
              href={"/student/reservar?date=" + dateKey}
              aria-current={isToday ? "date" : undefined}
              aria-label={"Ver clases del " + dateKey}
              className={
                "flex h-[70px] w-[45px] min-w-0 flex-col items-center justify-center rounded-[17px] border transition " +
                (isToday
                  ? "border-[#ff52bf] bg-[#ff2ea8] text-[#0d050d]"
                  : "border-[#383d4c] bg-[#11131b] text-[#f7f8fb]")
              }
            >
              <span
                className={
                  "text-[11px] leading-[13px] " +
                  (isToday ? "font-semibold" : "font-normal text-[#9aa3b2]")
                }
              >
                {weekday}
              </span>
              <strong className="mt-1 text-[18px] font-semibold leading-[22px]">{chip.day}</strong>
            </Link>
          );
        })}
      </nav>

      <section className="mt-4">
        <div className="flex h-[34px] items-center justify-between">
          <h2 className="text-[28px] font-bold leading-[34px] tracking-[-0.035em] text-[#f7f8fb]">
            Tu espacio
          </h2>
          <Link href="/student/perfil" className="pr-1 text-[13px] leading-4 text-[#dcd7e5]">
            Ver todo →
          </Link>
        </div>

        <div className="mt-[9px] grid grid-cols-[minmax(0,1.153fr)_minmax(0,1fr)] grid-rows-[143px_151px] gap-x-[10px] gap-y-[10px]">
          <Link
            href={nextClass ? "/student/mis-clases" : "/student/reservar"}
            data-home-block="space-next-class"
            className="row-span-2 overflow-hidden rounded-[24px] border border-[rgba(94,82,111,.7)] bg-[#12141c]"
          >
            <div
              className="relative h-[152px] bg-cover bg-center"
              style={{
                backgroundImage: `url("${nextClassArtworkUrl ?? "/student/home-pole-fallback.jpg"}")`,
              }}
            >
              {nextClassArtworkUrl ? (
                <span className="absolute left-3 top-3 rounded-full bg-[#ff94c7] px-[9px] py-[5px] text-[9px] font-semibold leading-3 text-[#0b0d12]">
                  ✓ Confirmada
                </span>
              ) : null}
            </div>

            <div className="relative h-[152px] px-[13px] pt-[12px]">
              <h3 className="truncate text-[23px] font-bold leading-[28px] tracking-[-0.025em] text-[#f7f8fb]">
                {nextClass?.activity ?? "Reserva tu clase"}
              </h3>

              {nextClass ? (
                <div className="mt-[9px] space-y-[7px] text-[13px] leading-4 text-[#ded8e6]">
                  <p>▣&nbsp;&nbsp;{dateOnly(nextClass.starts_at, studio.timezone)}</p>
                  <p>
                    ◷&nbsp;&nbsp;{timeOnly(nextClass.starts_at, studio.timezone)}–
                    {timeOnly(nextClass.ends_at, studio.timezone)}
                  </p>
                  <p>●&nbsp;&nbsp;{nextClass.space ?? "Estudio"}</p>
                </div>
              ) : (
                <p className="mt-3 text-[11px] leading-4 text-[#9aa3b2]">
                  Encuentra una clase y reserva tu lugar.
                </p>
              )}

              <div className="absolute inset-x-[13px] bottom-[6px] flex h-[38px] items-center border-t border-[#3f424f] pt-1">
                <span
                  aria-hidden="true"
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-fuchsia-500 bg-[#261424] text-[11px] font-semibold text-white"
                >
                  {(nextClass?.coach ?? "C").slice(0, 1).toUpperCase()}
                </span>
                <span className="ml-1 min-w-0 flex-1 text-[10px] leading-[12px] text-[#c4bccc]">
                  <span className="block">Coach</span>
                  <span className="block truncate">{nextClass?.coach ?? "Por confirmar"}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-[#4f5263] bg-[#22242d] text-[20px] leading-none text-white"
                >
                  ›
                </span>
              </div>
            </div>
          </Link>

          <Link
            href="/student/paquete"
            data-home-block="package"
            className="relative overflow-hidden rounded-[24px] border border-[#e8d8ff] bg-[#ccbcfa] px-[13px] pt-[13px] text-[#0f0a14]"
          >
            <p className="truncate pr-1 text-[18px] font-bold leading-[22px]">Mi paquete 🎁</p>

            {activePackage?.unlimited ? (
              <p className="mt-2 text-[25px] font-semibold leading-8">Ilimitado</p>
            ) : activePackage ? (
              <div className="mt-[5px] flex items-end gap-2">
                <strong className="text-[29px] font-semibold leading-[35px]">{classesAvailable ?? 0}</strong>
                <span className="pb-[3px] text-[16px] font-semibold leading-5">disponibles</span>
              </div>
            ) : (
              <p className="mt-2 text-[20px] font-semibold leading-6">Sin paquete</p>
            )}

            <span
              aria-hidden="true"
              className="absolute right-[12px] top-[43px] flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/55 text-[22px] text-[#11121a]"
            >
              ›
            </span>

            {activePackage && !activePackage.unlimited && activePackage.credit_limit ? (
              <>
                <div className="mt-[7px] h-[9px] overflow-hidden rounded-full bg-[#e0d6f5]">
                  <div
                    className="h-full rounded-full bg-[#ff0a8a]"
                    style={{ width: `${packageAvailablePercent}%` }}
                  />
                </div>
                <p className="mt-[4px] text-[11px] leading-[13px] text-[#4d4261]">
                  {classesAvailable ?? 0} de {activePackage.credit_limit} clases
                </p>
              </>
            ) : (
              <p className="mt-[7px] text-[10px] leading-[13px] text-[#4d4261]">
                {activePackage ? "Sin límite de clases" : "Activa uno para reservar"}
              </p>
            )}

            <div
              className={
                "absolute inset-x-[11px] bottom-[6px] flex h-[20px] items-center justify-between rounded-[10px] px-2 text-[10px] " +
                (giftClassesAvailable > 0
                  ? "bg-[#ffa1d4] text-[#8a0a54]"
                  : "bg-white/30 text-[#665b75]")
              }
            >
              <span className="truncate">
                🎁 {giftClassesAvailable > 0 ? `+${giftClassesAvailable} clases de regalo` : "Sin clases de regalo"}
              </span>
              <span aria-hidden="true" className="text-[16px] leading-none">
                ›
              </span>
            </div>
          </Link>

          <Link
            href={rewardsUnlocked ? "/student/recompensas/medallero" : "/student/recompensas"}
            data-home-block="medal"
            className="relative overflow-hidden rounded-[24px] border border-[#4f495b] bg-[#12131b] px-[13px] pt-[13px]"
          >
            {rewardsUnlocked ? (
              <>
                <p className="truncate pr-1 text-[13px] font-semibold leading-[17px] text-[#f7f8fb]">
                  Medalla actual 🏅
                </p>
                <p className="mt-[12px] max-w-[96px] truncate text-[19px] font-semibold leading-6 text-[#f7f8fb]">
                  {medalTitle}
                </p>
                <p className="mt-[7px] max-w-[94px] text-[10.5px] leading-[13px] text-[#9aa3b2]">
                  Por tu constancia
                  <br />y progreso
                </p>

                {currentMedalKey === "diamond" ? (
                  <Image
                    src="/student/diamond-medal.jpg"
                    alt=""
                    width={58}
                    height={58}
                    className="absolute right-[6px] top-[42px] h-[58px] w-[58px] rounded-full object-cover"
                  />
                ) : (
                  <MedalArtwork
                    medalKey={currentMedalKey}
                    className="absolute right-[6px] top-[42px] h-[58px] w-[58px]"
                  />
                )}

                <span aria-hidden="true" className="absolute bottom-[7px] right-[17px] text-[24px] leading-none text-white">
                  ›
                </span>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold leading-[15px] text-white">Tu primera medalla 🏅</p>
                <p className="mt-[5px] max-w-[110px] text-[17px] font-semibold leading-[19px] text-white">
                  Desbloquea Bronce
                </p>
                <p className="mt-[5px] text-[9px] leading-3 text-[#9aa3b2]">
                  {onboardingCompleted} de {onboardingSteps.length} pasos completados
                </p>
                <div
                  className="mt-[7px] grid grid-cols-6 gap-[3px]"
                  role="progressbar"
                  aria-label="Progreso para desbloquear Bronce"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={onboardingPercent}
                >
                  {onboardingSteps.map((_, index) => (
                    <span
                      key={index}
                      aria-hidden="true"
                      className={
                        "h-[6px] rounded-full " +
                        (index < onboardingCompleted ? "bg-[#ff0a8a]" : "bg-white/10")
                      }
                    />
                  ))}
                </div>
                <span className="absolute inset-x-[13px] bottom-[8px] text-[10px] font-semibold text-[#ff78bd]">
                  Continuar activación →
                </span>
              </>
            )}
          </Link>
        </div>
      </section>
    </main>
  );
}
