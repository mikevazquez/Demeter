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
  return `Hoy ${new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${dateKey}T12:00:00Z`))
    .replace(".", "")}.`;
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

function medalEmoji(key: string | null) {
  if (key === "diamond") return "💎";
  if (key === "gold") return "🥇";
  if (key === "silver") return "🥈";
  return "🥉";
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
  ]);

  const rewardStatus = (rewardStatusResult.data as RewardStatusSnapshot | null) ?? null;
  const levelDefinitions = (rewardLevelsResult.data ?? []) as RewardLevelDefinitionRow[];
  const fallbackLevelKey = rewardMembershipResult.data?.current_level_key ?? null;
  const fallbackLevel =
    levelDefinitions.find((level) => level.level_key === fallbackLevelKey) ?? null;
  const currentMedal = rewardStatus?.access_unlocked
    ? (rewardStatus.current_medal ?? rewardStatus.current_level ?? fallbackLevel)
    : null;
  const currentMedalKey =
    currentMedal?.key ??
    fallbackLevel?.level_key ??
    (rewardStatus?.access_unlocked ? "bronze" : null);
  const medalTitle = currentMedal?.title ?? fallbackLevel?.title ?? "Por activar";

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
  const [
    { data: artworkSessionRows },
    { data: artworkTemplateRows },
    { data: artworkDisciplineRows },
  ] = await Promise.all([
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
    nextClass?.discipline
      ? supabase
          .from("disciplines")
          .select("*")
          .eq("studio_id", membership.studio_id)
          .eq("name", nextClass.discipline)
          .limit(1)
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
  const disciplineArtworkPath =
    artworkDisciplineRows?.[0] && typeof artworkDisciplineRows[0].cover_image_path === "string"
      ? artworkDisciplineRows[0].cover_image_path
      : null;
  const nextClassArtworkPath = sessionArtworkPath ?? activityArtworkPath ?? disciplineArtworkPath;
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
  const packageSummary = activePackage
    ? activePackage.unlimited
      ? "Ilimitado"
      : `${classesAvailable ?? 0} disponibles`
    : "Sin paquete";

  return (
    <main className="mx-auto max-w-3xl space-y-5 pb-5">
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

      <section className="flex items-center gap-3">
        <Link
          href="/student/perfil"
          aria-label="Abrir mi perfil"
          className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-fuchsia-400/80 bg-fuchsia-500/10 text-xl font-semibold text-white shadow-[0_0_28px_rgba(255,10,138,0.2)]"
        >
          <span aria-hidden="true">{snapshot.profile.first_name.slice(0, 1).toUpperCase()}</span>
          <Image src="/student/perfil/avatar" alt="" fill unoptimized className="object-cover" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Hola, {snapshot.profile.first_name} 👋
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">{todayLabel(today)}</p>
        </div>

        <Link
          href="/student/reservar"
          aria-label="Reservar una clase"
          className="flex h-12 shrink-0 items-center justify-center rounded-full border border-fuchsia-400/25 bg-fuchsia-500/[0.08] px-4 text-sm font-semibold text-fuchsia-200 transition hover:border-fuchsia-400/45 hover:bg-fuchsia-500/[0.12] hover:text-white"
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
        className="relative block min-h-[230px] overflow-hidden rounded-[1.65rem] border border-fuchsia-400/45 p-5 shadow-[0_22px_70px_rgba(255,10,138,0.12)] sm:min-h-[280px] sm:p-6"
        style={{
          backgroundImage: nextClassArtworkUrl
            ? `linear-gradient(90deg, rgba(12,7,14,.94) 6%, rgba(21,7,20,.78) 48%, rgba(16,7,18,.22) 100%), url("${nextClassArtworkUrl}")`
            : "radial-gradient(circle at 78% 30%, rgba(255,10,138,.46), transparent 28%), radial-gradient(circle at 92% 82%, rgba(164,112,255,.28), transparent 26%), linear-gradient(145deg,#301128,#160d17 52%,#0a0b10)",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div
          aria-hidden="true"
          className="absolute -right-7 top-10 h-32 w-32 rounded-full border-[18px] border-fuchsia-400/35 shadow-[0_0_36px_rgba(255,10,138,.24)]"
        />
        <div
          aria-hidden="true"
          className="absolute right-16 top-24 h-20 w-20 rounded-full border-[13px] border-violet-300/25"
        />

        <div className="relative z-10 max-w-[78%]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-200">
            {nextClass
              ? "Tu próxima clase"
              : activePackage
                ? "Tu próximo movimiento"
                : "Sigue entrenando"}
          </p>

          {nextClass ? (
            <>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {nextClass.activity} ✨
              </h2>
              <p className="mt-2 text-lg font-semibold text-white">
                {timeOnly(nextClass.starts_at, studio.timezone)}
                {nextClass.space ? (
                  <span className="font-normal text-zinc-300"> · {nextClass.space}</span>
                ) : null}
              </p>
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-200">
                <span
                  aria-hidden="true"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-400 text-xs font-bold text-black"
                >
                  ✓
                </span>
                {nextClass.coach ? `Coach ${nextClass.coach} · ` : ""}
                Tu lugar está confirmado
              </p>
            </>
          ) : activePackage ? (
            <>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Reserva tu próxima clase ✨
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                {activePackage.unlimited
                  ? "Tu paquete ilimitado está listo."
                  : `Tienes ${classesAvailable ?? 0} clases disponibles.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Activa tu paquete 🎁
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Elige un paquete para comenzar a reservar.
              </p>
            </>
          )}
        </div>
      </Link>

      <section
        aria-label="Tu semana"
        className="rounded-[1.55rem] border border-white/10 bg-white/[0.025] p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-4 px-1">
          <div>
            <p className="text-sm font-semibold text-white">Tu semana 📅</p>
            <p className="mt-0.5 text-xs text-zinc-500">Toca un día para ver sus clases.</p>
          </div>
          <Link
            href="/student/reservar"
            className="inline-flex min-h-10 items-center text-xs font-semibold text-fuchsia-300"
          >
            Ver agenda →
          </Link>
        </div>

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid min-w-[520px] grid-cols-7 gap-2">
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
                    "relative flex min-h-[76px] flex-col items-center justify-center rounded-2xl border px-2 transition " +
                    (isToday
                      ? "border-fuchsia-400/70 bg-fuchsia-500 text-white shadow-[0_10px_28px_rgba(255,10,138,.18)]"
                      : isNextClassDay
                        ? "border-fuchsia-400/35 bg-fuchsia-500/[0.09] text-white"
                        : "border-white/10 bg-[#101119] text-zinc-400 hover:border-fuchsia-400/30 hover:text-white")
                  }
                >
                  <span className="text-[10px] font-semibold uppercase">{chip.weekday}</span>
                  <strong className="mt-1 text-lg leading-none">{chip.day}</strong>
                  <span
                    aria-hidden="true"
                    className={
                      "mt-2 h-1.5 w-1.5 rounded-full " +
                      (hasReservation
                        ? isToday
                          ? "bg-white"
                          : "bg-fuchsia-400"
                        : "bg-transparent")
                    }
                  />
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300/85">
              Todo lo tuyo
            </p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-white">Tu espacio</h2>
          </div>
          <Link
            href="/student/perfil"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-zinc-300"
          >
            Ver todo →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href={nextClass ? "/student/mis-clases" : "/student/reservar"}
            data-home-block="space-next-class"
            className="group col-span-2 overflow-hidden rounded-[1.55rem] border border-fuchsia-400/35 bg-[#101119]"
          >
            <div
              className="relative min-h-[180px]"
              style={{
                backgroundImage: nextClassArtworkUrl
                  ? `linear-gradient(180deg, transparent 28%, rgba(11,9,15,.86) 100%), url("${nextClassArtworkUrl}")`
                  : "radial-gradient(circle at 58% 30%, rgba(255,10,138,.5), transparent 34%), linear-gradient(145deg,#32132e,#11131b)",
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            >
              <span className="absolute left-3 top-3 rounded-full bg-fuchsia-300 px-3 py-1 text-[11px] font-semibold text-black">
                ✓ {nextClass ? "Confirmada" : "Disponible"}
              </span>
            </div>

            <div className="p-4">
              <h3 className="truncate text-xl font-semibold text-white">
                {nextClass?.activity ?? "Reserva tu clase"}
              </h3>
              {nextClass ? (
                <div className="mt-3 space-y-2 text-sm text-zinc-300">
                  <p>📅 {dateOnly(nextClass.starts_at, studio.timezone)}</p>
                  <p>🕒 {formatDateTime(nextClass.starts_at, studio.timezone)}</p>
                  <p>📍 {nextClass.space ?? "Estudio"}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Encuentra una clase y reserva tu lugar.
                </p>
              )}

              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-xs text-zinc-500">Coach</p>
                <p className="mt-1 truncate text-sm font-semibold text-white">
                  {nextClass?.coach ?? "Por confirmar"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/student/paquete"
            data-home-block="package"
            className="group overflow-hidden rounded-[1.55rem] border border-violet-300/25 bg-[linear-gradient(145deg,#d9c8ff,#bda8f4)] p-4 text-[#17111f]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-semibold">Mi paquete 🎁</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{packageSummary}</p>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/55 text-xl">
                ›
              </span>
            </div>

            {activePackage && !activePackage.unlimited && activePackage.credit_limit ? (
              <>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/45">
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${packageUsagePercent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-[#5f5470]">
                  {activePackage.used_credits} de {activePackage.credit_limit} clases usadas
                </p>
              </>
            ) : null}

            <div
              className={
                "mt-4 rounded-2xl px-3 py-2.5 text-xs font-semibold " +
                (giftClassesAvailable > 0
                  ? "bg-fuchsia-300/65 text-fuchsia-950"
                  : "bg-white/35 text-[#675a75]")
              }
            >
              🎁 {giftClassesAvailable}{" "}
              {giftClassesAvailable === 1 ? "clase de regalo" : "clases de regalo"}
            </div>
          </Link>

          <Link
            href={
              rewardStatus?.access_unlocked
                ? "/student/recompensas/medallero"
                : "/student/recompensas"
            }
            data-home-block="medal"
            className="relative overflow-hidden rounded-[1.55rem] border border-white/10 bg-[radial-gradient(circle_at_82%_72%,rgba(168,115,255,.26),transparent_33%),linear-gradient(145deg,#171821,#0c0e14)] p-4"
          >
            <p className="text-sm font-semibold text-white">Medalla actual 🏅</p>
            <p className="mt-3 truncate text-2xl font-semibold text-white">{medalTitle}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {rewardStatus?.access_unlocked
                ? "Por tu constancia"
                : "Actívala completando tu onboarding"}
            </p>
            <span
              aria-hidden="true"
              className="absolute bottom-2 right-3 text-5xl drop-shadow-[0_0_20px_rgba(168,115,255,.34)]"
            >
              {medalEmoji(currentMedalKey)}
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
