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
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00Z`));

  return value.charAt(0).toUpperCase() + value.slice(1);
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
  const packageUsagePercent =
    activePackage && !activePackage.unlimited && activePackage.credit_limit
      ? Math.min(100, Math.round((activePackage.used_credits / activePackage.credit_limit) * 100))
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
  const calendarDays = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const upcomingDates = new Set(
    sortedUpcoming.map((item) => localDateKey(new Date(item.starts_at), studio.timezone)),
  );
  const nextClassDate = nextClass
    ? localDateKey(new Date(nextClass.starts_at), studio.timezone)
    : null;

  return (
    <main className="mx-auto max-w-[393px] space-y-3.5 pb-5">
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

      <section className="flex items-center gap-2.5">
        <Link
          href="/student/perfil"
          aria-label="Abrir mi perfil"
          className="relative flex h-[54px] w-[54px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-fuchsia-500 bg-[#261424] text-lg font-semibold text-white"
        >
          <span aria-hidden="true">{snapshot.profile.first_name.slice(0, 1).toUpperCase()}</span>
          <Image src="/student/perfil/avatar" alt="" fill unoptimized className="object-cover" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[23px] font-semibold leading-[31px] tracking-tight text-white">
            Hola, {snapshot.profile.first_name} 👋
          </h1>
          <p className="truncate text-[11px] leading-[15px] text-zinc-500">{todayLabel(today)}</p>
        </div>

        <Link
          href="/student/reservar"
          aria-label="Reservar una clase"
          className="flex shrink-0 items-center justify-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/[0.08] px-[13px] py-2.5 text-[11px] font-semibold text-white transition hover:bg-fuchsia-500/[0.14]"
        >
          Reservar ✨
        </Link>
      </section>

      {priorityNotification ? (
        <Link
          href={`/student/notificaciones/${priorityNotification.id}`}
          data-home-block="priority-action"
          className={`block rounded-2xl border p-4 ${priorityNotificationTone(
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
          className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.055] p-4"
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
          className="rounded-2xl border border-violet-400/25 bg-violet-400/[0.055] p-4"
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
        className="relative block h-[212px] overflow-hidden rounded-[26px] border border-fuchsia-500/45"
        style={{
          backgroundImage: nextClassArtworkUrl
            ? `linear-gradient(90deg,rgba(10,5,13,.94) 0%,rgba(20,6,18,.65) 58%,rgba(10,5,13,.16) 100%),url("${nextClassArtworkUrl}")`
            : "radial-gradient(circle at 78% 30%,rgba(255,10,138,.40),transparent 30%),linear-gradient(145deg,#291021,#130b14 58%,#090a0e)",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="relative z-10 w-[72%] p-[18px]">
          <p className="text-[9px] font-semibold uppercase leading-3 tracking-[0.18em] text-fuchsia-400">
            {nextClass
              ? "Tu próxima clase"
              : activePackage
                ? "Tu próximo movimiento"
                : "Sigue entrenando"}
          </p>

          {nextClass ? (
            <>
              <h2 className="mt-1 text-[30px] font-semibold leading-10 tracking-tight text-white">
                {nextClass.activity} ✨
              </h2>
              <p className="text-[15px] font-semibold leading-5 text-white">
                {timeOnly(nextClass.starts_at, studio.timezone)}
                {nextClass.space ? ` · ${nextClass.space}` : ""}
              </p>
              <p className="mt-7 flex items-center gap-2 text-[10px] leading-[13px] text-zinc-100">
                <span
                  aria-hidden="true"
                  className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-fuchsia-500 text-[10px] font-bold text-white"
                >
                  ✓
                </span>
                <span className="truncate">
                  {nextClass.coach ? `Coach ${nextClass.coach} · ` : ""}
                  Tu lugar está confirmado
                </span>
              </p>
            </>
          ) : activePackage ? (
            <>
              <h2 className="mt-2 text-[28px] font-semibold leading-9 tracking-tight text-white">
                Reserva tu próxima clase ✨
              </h2>
              <p className="mt-2 text-xs leading-5 text-zinc-300">
                {activePackage.unlimited
                  ? "Tu paquete ilimitado está listo."
                  : `Tienes ${classesAvailable ?? 0} clases disponibles.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-2 text-[28px] font-semibold leading-9 tracking-tight text-white">
                Activa tu paquete 🎁
              </h2>
              <p className="mt-2 text-xs leading-5 text-zinc-300">
                Elige un paquete para comenzar a reservar.
              </p>
            </>
          )}
        </div>
      </Link>

      <section
        aria-label="Tu semana"
        className="rounded-[24px] border border-white/[0.08] bg-[#151922] p-3"
      >
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-[17px] text-white">Tu semana 📅</p>
            <p className="truncate text-[9px] leading-3 text-zinc-500">
              Toca un día para ver sus clases.
            </p>
          </div>
          <Link href="/student/reservar" className="shrink-0 text-[9px] font-semibold text-fuchsia-400">
            Ver agenda →
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((dateKey) => {
            const chip = calendarChip(dateKey);
            const isToday = dateKey === today;
            const hasReservation = upcomingDates.has(dateKey);
            const isNextClassDay = dateKey === nextClassDate;

            return (
              <Link
                key={dateKey}
                href={"/student/reservar?date=" + dateKey}
                aria-label={"Ver clases del " + dateKey}
                className={
                  "flex min-h-[58px] min-w-0 flex-col items-center justify-center rounded-[14px] border px-1 transition " +
                  (isToday
                    ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                    : isNextClassDay
                      ? "border-fuchsia-500/30 bg-fuchsia-500/[0.08] text-white"
                      : "border-white/[0.07] bg-[#0f1117] text-zinc-400 hover:border-fuchsia-500/30")
                }
              >
                <span className="text-[8px] font-semibold uppercase leading-[11px]">
                  {chip.weekday.slice(0, 1)}
                </span>
                <strong className="mt-0.5 text-sm leading-[19px]">{chip.day}</strong>
                <span
                  aria-hidden="true"
                  className={
                    "mt-1 h-[5px] w-[5px] rounded-full " +
                    (hasReservation
                      ? isToday
                        ? "bg-white"
                        : "bg-fuchsia-500"
                      : "bg-transparent")
                  }
                />
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-[8px] font-semibold uppercase leading-[11px] tracking-[0.18em] text-fuchsia-400">
              Todo lo tuyo
            </p>
            <h2 className="mt-0.5 text-[26px] font-semibold leading-[35px] tracking-tight text-white">
              Tu espacio
            </h2>
          </div>
          <Link href="/student/perfil" className="pb-1 text-[10px] font-semibold text-zinc-400">
            Ver todo →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href={nextClass ? "/student/mis-clases" : "/student/reservar"}
            data-home-block="space-next-class"
            className="group col-span-2 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#151922]"
          >
            <div
              className="relative h-[166px]"
              style={{
                backgroundImage: nextClassArtworkUrl
                  ? `linear-gradient(180deg,transparent 20%,rgba(8,5,10,.78) 100%),url("${nextClassArtworkUrl}")`
                  : "radial-gradient(circle at 58% 30%,rgba(255,10,138,.48),transparent 34%),linear-gradient(145deg,#32132e,#11131b)",
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            >
              <span className="absolute left-3 top-3 rounded-full bg-[#ff94c7] px-[9px] py-[5px] text-[9px] font-semibold leading-3 text-[#0b0d12]">
                ✓ {nextClass ? "Confirmada" : "Disponible"}
              </span>
            </div>

            <div className="space-y-[5px] p-[14px]">
              <h3 className="truncate text-lg font-semibold leading-6 text-white">
                {nextClass?.activity ?? "Reserva tu clase"}
              </h3>
              {nextClass ? (
                <>
                  <p className="text-[10px] leading-[13px] text-zinc-400">
                    📅 {dateOnly(nextClass.starts_at, studio.timezone)} · 🕒{" "}
                    {timeOnly(nextClass.starts_at, studio.timezone)}
                  </p>
                  <p className="text-[10px] leading-[13px] text-zinc-400">
                    📍 {nextClass.space ?? "Estudio"}
                  </p>
                </>
              ) : (
                <p className="text-[10px] leading-[15px] text-zinc-400">
                  Encuentra una clase y reserva tu lugar.
                </p>
              )}

              <div className="mt-2 border-t border-white/[0.08] pt-2">
                <p className="text-[8px] leading-[11px] text-zinc-500">Coach</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold leading-[15px] text-white">
                  {nextClass?.coach ?? "Por confirmar"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/student/paquete"
            data-home-block="package"
            className="flex min-h-[230px] flex-col overflow-hidden rounded-[24px] border border-fuchsia-400/35 bg-[linear-gradient(145deg,#611f57_0%,#381a45_55%,#1f1229_100%)] p-[14px] text-white"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold leading-[17px]">Mi paquete 🎁</p>
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/15 text-lg">
                ›
              </span>
            </div>

            <div className="mt-1">
              {activePackage?.unlimited ? (
                <p className="text-[26px] font-semibold leading-8">Ilimitado</p>
              ) : activePackage ? (
                <>
                  <p className="text-[29px] font-semibold leading-[38px]">{classesAvailable ?? 0}</p>
                  <p className="text-[24px] font-semibold leading-8">disponibles</p>
                </>
              ) : (
                <>
                  <p className="text-[24px] font-semibold leading-8">Sin paquete</p>
                  <p className="text-[11px] text-white/65">Activa uno para reservar</p>
                </>
              )}
            </div>

            {activePackage && !activePackage.unlimited && activePackage.credit_limit ? (
              <>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${packageUsagePercent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] leading-[13px] text-white/70">
                  {activePackage.used_credits} de {activePackage.credit_limit} clases usadas
                </p>
              </>
            ) : null}

            <div
              className={
                "mt-auto flex items-center justify-between rounded-[14px] px-2.5 py-[9px] text-[9px] font-semibold " +
                (giftClassesAvailable > 0 ? "bg-fuchsia-600/40 text-white" : "bg-white/[0.08] text-white/55")
              }
            >
              <span>
                🎁 {giftClassesAvailable}{" "}
                {giftClassesAvailable === 1 ? "clase de regalo" : "clases de regalo"}
              </span>
              <span aria-hidden="true">›</span>
            </div>
          </Link>

          <Link
            href={rewardsUnlocked ? "/student/recompensas/medallero" : "/student/recompensas"}
            data-home-block="medal"
            className="relative flex min-h-[230px] flex-col overflow-hidden rounded-[24px] border border-fuchsia-400/30 bg-[linear-gradient(145deg,#1a0f1c,#090a0e)] px-[14px] pb-3 pt-[14px]"
          >
            {rewardsUnlocked ? (
              <>
                <p className="text-[11px] font-semibold leading-[15px] text-white">
                  Medalla actual 🏅
                </p>
                <p className="mt-1 text-[22px] font-semibold leading-[29px] text-white">
                  {medalTitle}
                </p>
                <p className="text-[10px] leading-[13px] text-zinc-500">Por tu constancia</p>
                <MedalArtwork
                  medalKey={currentMedalKey}
                  className="mx-auto mt-1 h-[88px] w-[88px]"
                />
                <span className="mt-auto rounded-[14px] border border-fuchsia-400/20 bg-white/[0.05] px-2 py-2 text-center text-[9px] font-semibold text-white">
                  Ver medallero →
                </span>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold leading-[15px] text-white">
                  Tu primera medalla 🏅
                </p>
                <h3 className="mt-1 text-[19px] font-semibold leading-[21px] text-white">
                  Desbloquea
                  <br />
                  Bronce
                </h3>
                <p className="mt-1 max-w-[112px] text-[9px] leading-3 text-zinc-500">
                  Completa tu onboarding para obtener tu primera medalla.
                </p>

                <MedalArtwork
                  medalKey="bronze"
                  dimmed
                  className="absolute -right-3 top-[68px] h-[78px] w-[78px]"
                />

                <div className="mt-auto">
                  <p className="mb-1.5 text-[9px] leading-3 text-zinc-200">
                    {onboardingCompleted} de {onboardingSteps.length} pasos completados
                  </p>
                  <div
                    className="grid grid-cols-6 gap-[3px]"
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
                          "h-[7px] rounded-full " +
                          (index < onboardingCompleted ? "bg-fuchsia-500" : "bg-white/10")
                        }
                      />
                    ))}
                  </div>
                </div>

                <span className="mt-2.5 rounded-[14px] bg-fuchsia-500 px-2 py-[9px] text-center text-[9px] font-semibold text-white">
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
