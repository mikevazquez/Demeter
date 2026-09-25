import Image from "next/image";
import Link from "next/link";

import {
  formatDate,
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentAcquisition,
} from "@/lib/student/portal";

import StudentNoticeDialog from "./components/StudentNoticeDialog";

type RewardLevelView = {
  key?: string;
  title?: string;
  required_active_days?: number;
  max_no_shows?: number;
  min_continuity_months?: number;
  max_renewal_gap_days?: number;
  waitlist_priority?: number;
  private_discount_pct?: number;
  event_discount_pct?: number;
  monthly_guest_invites?: number;
  benefits_definition?: Record<string, unknown> | null;
};

type RewardLevelDefinitionRow = RewardLevelView & {
  level_key: string;
  level_order: number;
};

type RewardStatusSnapshot = {
  access_unlocked?: boolean;
  medal_key?: string | null;
  medal_title?: string | null;
  current_medal?: RewardLevelView | null;
  current_level?: RewardLevelView | null;
};

type EvaluationHomeCard = {
  discipline_id: string;
  discipline_name: string;
  current_level_title: string;
  invitation_id: string | null;
  invitation_kind: "first" | "periodic" | null;
  invitation_status: "offered" | "pending_schedule" | "scheduled" | "in_progress" | null;
  window_start: string | null;
  window_end: string | null;
};

type EvaluationHomeHistoryItem = {
  id: string;
  discipline_name: string;
  evaluated_level_title: string | null;
  resulting_level_title: string | null;
  evaluation_date: string;
  total_score: number | null;
  final_outcome: "approved" | "stays" | null;
  published_at: string | null;
};

type StudentEvaluationsHomeSnapshot = {
  disciplines?: EvaluationHomeCard[];
  history?: EvaluationHomeHistoryItem[];
};

type AppNotificationHomeItem = {
  id: string;
  title: string;
  body: string;
  notification_type: string;
  created_at: string;
  payload: Record<string, unknown>;
};

type BookingRestriction = {
  code: string;
  type?: string | null;
  title: string;
  detail?: string | null;
  action_kind?: string | null;
  action_href?: string | null;
  action_label?: string | null;
};

const medalVisuals = {
  bronze: {
    accent: "#CD7F32",
    border: "rgba(205,127,50,0.52)",
    wash: "rgba(205,127,50,0.12)",
  },
  silver: {
    accent: "#C0C0C0",
    border: "rgba(192,192,192,0.5)",
    wash: "rgba(192,192,192,0.1)",
  },
  gold: {
    accent: "#D4AF37",
    border: "rgba(212,175,55,0.56)",
    wash: "rgba(212,175,55,0.13)",
  },
  diamond: {
    accent: "#5EDFFF",
    border: "rgba(94,223,255,0.58)",
    wash: "rgba(94,223,255,0.13)",
  },
} as const;

const urgentNotificationTypes = new Set([
  "session_minimum_cancelled",
  "class_cancelled_student",
  "class_rescheduled",
  "waitlist_promoted",
]);

function dateDistanceInDays(from: string, to: string) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function availableClasses(activePackage: StudentAcquisition | null) {
  if (!activePackage || activePackage.unlimited) return null;
  return activePackage.available_credits ?? 0;
}

function weekDays(dateKey: string) {
  const anchor = new Date(`${dateKey}T12:00:00Z`);
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);

    return {
      key,
      label: new Intl.DateTimeFormat("es-MX", {
        weekday: "narrow",
        timeZone: "UTC",
      })
        .format(day)
        .toUpperCase(),
      day: day.getUTCDate(),
    };
  });
}

function monthLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function priorityNotificationTone(type: string) {
  if (type === "class_rescheduled" || type === "waitlist_promoted") {
    return {
      border: "border-amber-400/30",
      background: "bg-amber-400/[0.055]",
      label: "text-amber-200",
      button: "border-amber-400/30 text-amber-100",
    };
  }

  return {
    border: "border-rose-400/30",
    background: "bg-rose-400/[0.055]",
    label: "text-rose-200",
    button: "border-rose-400/30 text-rose-100",
  };
}

function HomeIcon({
  kind,
  className = "h-6 w-6",
}: {
  kind: "reserve" | "classes" | "package" | "technical" | "notice";
  className?: string;
}) {
  if (kind === "reserve") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="3.5" y="5.5" width="17" height="15" rx="3" />
        <path d="M8 3v5M16 3v5M3.5 10h17M12 13v5M9.5 15.5h5" />
      </svg>
    );
  }

  if (kind === "classes") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="4" y="4.5" width="16" height="16" rx="3" />
        <path d="M8 2.5v4M16 2.5v4M4 9h16M8 13h8M8 17h5" />
      </svg>
    );
  }

  if (kind === "package") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M4.5 7.5h15v10h-15z" />
        <path d="M8 7.5a4 4 0 0 1 8 0M9 12h6M8 15h8" />
      </svg>
    );
  }

  if (kind === "technical") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M5 18v-4M9.5 18V9M14 18v-7M18.5 18V5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
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
    evaluationsResult,
    unreadEvaluationResult,
    appNotificationsResult,
    bookingRestrictionsResult,
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
        "level_key,level_order,title,required_active_days,max_no_shows,min_continuity_months,max_renewal_gap_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites,benefits_definition",
      )
      .eq("studio_id", membership.studio_id)
      .order("level_order"),
    supabase.rpc("student_evaluations_snapshot"),
    supabase.rpc("student_latest_unread_evaluation_result"),
    supabase
      .from("app_notifications")
      .select("id,title,body,notification_type,created_at,payload")
      .eq("student_id", snapshot.profile.student_id)
      .eq("recipient_kind", "student")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.rpc("student_booking_restrictions_snapshot", { p_session_id: null }),
  ]);

  const rewardStatus = (rewardStatusResult.data as RewardStatusSnapshot | null) ?? null;
  const evaluationsSnapshot =
    (evaluationsResult.data as StudentEvaluationsHomeSnapshot | null) ?? null;
  const latestPublishedEvaluation =
    (unreadEvaluationResult.data as EvaluationHomeHistoryItem | null) ?? null;
  const unreadNotifications = (appNotificationsResult.data ?? []) as AppNotificationHomeItem[];
  const priorityNotification =
    unreadNotifications.find((item) => urgentNotificationTypes.has(item.notification_type)) ?? null;
  const bookingRestrictions = (bookingRestrictionsResult.data ?? []) as BookingRestriction[];
  const primaryRestriction = bookingRestrictions[0] ?? null;

  const activeEvaluationInvitation =
    evaluationsSnapshot?.disciplines?.find(
      (item) =>
        item.invitation_id &&
        (item.invitation_status === "offered" || item.invitation_status === "pending_schedule"),
    ) ?? null;

  const technicalLevelMap = new Map<string, { disciplineName: string; levelTitle: string }>();
  for (const evaluation of evaluationsSnapshot?.history ?? []) {
    if (!evaluation.resulting_level_title || technicalLevelMap.has(evaluation.discipline_name)) {
      continue;
    }

    technicalLevelMap.set(evaluation.discipline_name, {
      disciplineName: evaluation.discipline_name,
      levelTitle: evaluation.resulting_level_title,
    });
  }

  const technicalLevels = [...technicalLevelMap.values()];
  const primaryTechnicalLevel = technicalLevels[0] ?? null;
  const additionalTechnicalLevels = Math.max(0, technicalLevels.length - 1);

  const levelDefinitions = (rewardLevelsResult.data ?? []) as RewardLevelDefinitionRow[];
  const fallbackLevelKey = rewardMembershipResult.data?.current_level_key ?? null;
  const fallbackLevelRow =
    levelDefinitions.find((level) => level.level_key === fallbackLevelKey) ?? null;
  const toLevelView = (row: RewardLevelDefinitionRow | null): RewardLevelView | null =>
    row
      ? {
          key: row.level_key,
          title: row.title,
          required_active_days: row.required_active_days,
          max_no_shows: row.max_no_shows,
          min_continuity_months: row.min_continuity_months,
          max_renewal_gap_days: row.max_renewal_gap_days,
          waitlist_priority: row.waitlist_priority,
          private_discount_pct: row.private_discount_pct,
          event_discount_pct: row.event_discount_pct,
          monthly_guest_invites: row.monthly_guest_invites,
          benefits_definition: row.benefits_definition,
        }
      : null;

  const currentMedal = rewardStatus?.access_unlocked
    ? (rewardStatus.current_medal ?? rewardStatus.current_level ?? toLevelView(fallbackLevelRow))
    : null;
  const medalKey =
    currentMedal?.key === "silver" ||
    currentMedal?.key === "gold" ||
    currentMedal?.key === "diamond"
      ? currentMedal.key
      : "bronze";
  const medalVisual = medalVisuals[medalKey];

  const packageAcquisitions = snapshot.acquisitions.filter((item) => !item.reward_credit_wallet);
  const activePackage = packageAcquisitions.find((item) => item.active_now) ?? null;
  const classesAvailable = availableClasses(activePackage);

  const sortedUpcoming = [...snapshot.upcoming].sort(
    (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
  );
  const nextClass = sortedUpcoming[0] ?? null;
  const followingClass = sortedUpcoming[1] ?? null;

  const today = localDateKey(new Date(), studio.timezone);
  const calendarDays = weekDays(today);
  const currentMonthLabel = monthLabel(today);
  const daysUntilExpiration = activePackage
    ? dateDistanceInDays(today, activePackage.expires_on)
    : null;
  const expiresSoon =
    daysUntilExpiration !== null && daysUntilExpiration >= 0 && daysUntilExpiration <= 7;

  const technicalAction = latestPublishedEvaluation
    ? {
        label: "Ver resultado",
        href: `/student/evaluaciones/resultado/${latestPublishedEvaluation.id}`,
      }
    : activeEvaluationInvitation?.invitation_id
      ? {
          label:
            activeEvaluationInvitation.invitation_status === "offered"
              ? "Ver evaluación"
              : "Elegir mi clase",
          href:
            activeEvaluationInvitation.invitation_status === "offered"
              ? `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}`
              : `/student/evaluaciones/${activeEvaluationInvitation.invitation_id}/programar`,
        }
      : {
          label: "Ver nivel técnico",
          href: "/student/evaluaciones",
        };

  const technicalSummary = latestPublishedEvaluation
    ? (latestPublishedEvaluation.resulting_level_title ?? "Resultado disponible")
    : activeEvaluationInvitation
      ? "Evaluación disponible"
      : (primaryTechnicalLevel?.levelTitle ?? "Aún sin nivel");

  const medalSummary = currentMedal
    ? (currentMedal.title ?? "Bronce")
    : rewardStatus?.access_unlocked
      ? "Sin medalla"
      : "Por activar";

  const packageSummary = activePackage
    ? activePackage.unlimited
      ? "Clases ilimitadas"
      : `${classesAvailable ?? 0} clases disponibles`
    : "Sin paquete activo";
  const packageUsagePercent =
    activePackage && !activePackage.unlimited && activePackage.credit_limit
      ? Math.min(100, Math.round((activePackage.used_credits / activePackage.credit_limit) * 100))
      : 0;

  return (
    <main className="space-y-5 pb-5">
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

      <header className="relative overflow-hidden rounded-[1.75rem] border border-fuchsia-500/15 bg-[radial-gradient(circle_at_78%_18%,rgba(255,10,138,0.23),transparent_34%),linear-gradient(135deg,#130a12,#0c0c12_55%,#0a0b10)] px-5 py-5 sm:px-7 sm:py-6">
        <div
          aria-hidden="true"
          className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl"
        />
        <div className="relative flex items-center gap-3.5">
          <Link
            href="/student/perfil"
            className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/70 bg-fuchsia-500/10 text-lg font-semibold text-white shadow-[0_0_24px_rgba(255,10,138,0.22)]"
            aria-label="Abrir mi perfil"
          >
            <span aria-hidden="true">{snapshot.profile.first_name.slice(0, 1).toUpperCase()}</span>
            <Image src="/student/perfil/avatar" alt="" fill unoptimized className="object-cover" />
          </Link>
          <div className="min-w-0">
            <p className="text-sm text-zinc-400">¡Hola de nuevo!</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {snapshot.profile.first_name}
            </h1>
          </div>
        </div>
      </header>

      {priorityNotification ? (
        (() => {
          const tone = priorityNotificationTone(priorityNotification.notification_type);

          return (
            <section
              data-home-block="priority-action"
              className={`rounded-2xl border ${tone.border} ${tone.background} p-4`}
            >
              <p className={`text-xs font-semibold ${tone.label}`}>Necesita tu atención</p>
              <h2 className="mt-1.5 text-base font-semibold text-white">
                {priorityNotification.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-zinc-300">{priorityNotification.body}</p>
              <Link
                href={`/student/notificaciones/${priorityNotification.id}`}
                className={`mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold ${tone.button}`}
              >
                Ver detalle
              </Link>
            </section>
          );
        })()
      ) : primaryRestriction ? (
        <section
          data-home-block="priority-action"
          className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.055] p-4"
        >
          <p className="text-xs font-semibold text-amber-200">Necesitas resolver esto</p>
          <h2 className="mt-1.5 text-base font-semibold text-white">{primaryRestriction.title}</h2>
          {primaryRestriction.detail ? (
            <p className="mt-1 text-sm leading-6 text-zinc-300">{primaryRestriction.detail}</p>
          ) : null}
          {primaryRestriction.action_href ? (
            <Link
              href={primaryRestriction.action_href}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
            >
              {primaryRestriction.action_label || "Resolver"}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section
        data-home-block="next-class"
        className="relative min-h-[330px] overflow-hidden rounded-[2rem] border border-fuchsia-400/50 bg-[radial-gradient(circle_at_78%_28%,rgba(255,10,138,0.42),transparent_28%),radial-gradient(circle_at_92%_86%,rgba(119,34,255,0.20),transparent_30%),linear-gradient(145deg,#241020_0%,#120b13_44%,#090a0f_100%)] p-5 shadow-[0_22px_70px_rgba(255,10,138,0.14)] sm:min-h-[360px] sm:p-7"
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-[22%] w-px bg-gradient-to-b from-transparent via-fuchsia-300/80 to-transparent shadow-[0_0_18px_rgba(255,10,138,0.9)]"
        />
        <div
          aria-hidden="true"
          className="absolute -right-16 top-12 h-52 w-52 rounded-full border border-fuchsia-300/15 bg-fuchsia-500/[0.08] blur-[1px]"
        />
        <div
          aria-hidden="true"
          className="absolute -right-6 top-28 h-36 w-36 rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-10 right-8 h-28 w-28 rotate-12 rounded-[55%_45%_58%_42%] bg-gradient-to-br from-fuchsia-300/20 via-fuchsia-500/5 to-transparent blur-xl"
        />

        <div className="relative z-10 flex min-h-[288px] max-w-xl flex-col sm:min-h-[306px]">
          {nextClass ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-100/85">
                Tu próxima clase
              </p>
              <h2 className="mt-3 max-w-[80%] font-serif text-4xl font-semibold leading-[0.98] tracking-tight text-white sm:text-5xl">
                {nextClass.activity}
              </h2>

              <div className="mt-5 space-y-2.5 text-sm text-zinc-200 sm:text-base">
                <p className="flex items-center gap-2">
                  <span aria-hidden="true">◷</span>
                  {formatDateTime(nextClass.starts_at, studio.timezone)}
                </p>
                {nextClass.coach ? (
                  <p className="flex items-center gap-2">
                    <span aria-hidden="true">◎</span>
                    Coach {nextClass.coach}
                  </p>
                ) : null}
                {nextClass.space ? (
                  <p className="flex items-center gap-2">
                    <span aria-hidden="true">⌖</span>
                    {nextClass.space}
                  </p>
                ) : null}
                <p className="flex items-center gap-2 font-medium text-emerald-200">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-400/10 text-xs"
                  >
                    ✓
                  </span>
                  Tu lugar está confirmado
                </p>
              </div>

              <div className="mt-auto pt-6">
                <Link
                  href="/student/mis-clases"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-3 text-base font-semibold text-white shadow-[0_12px_34px_rgba(255,10,138,0.25)] transition hover:bg-fuchsia-500 sm:w-auto sm:min-w-52"
                >
                  Ver mi clase <span aria-hidden="true">→</span>
                </Link>
              </div>
            </>
          ) : activePackage ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-100/85">
                Tu próximo movimiento
              </p>
              <h2 className="mt-3 max-w-md font-serif text-4xl font-semibold leading-[1.02] text-white sm:text-5xl">
                Reserva tu próxima clase
              </h2>
              <p className="mt-4 max-w-sm text-base leading-7 text-zinc-300">
                {activePackage.unlimited
                  ? "Tu paquete ilimitado está listo para seguir entrenando."
                  : `Tienes ${classesAvailable ?? 0} clases disponibles para usar.`}
              </p>
              <div className="mt-auto pt-6">
                <Link
                  href="/student/reservar"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-3 text-base font-semibold text-white shadow-[0_12px_34px_rgba(255,10,138,0.25)] transition hover:bg-fuchsia-500 sm:w-auto sm:min-w-52"
                >
                  Reservar clase <span aria-hidden="true">→</span>
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-100/85">
                Sigue entrenando
              </p>
              <h2 className="mt-3 max-w-md font-serif text-4xl font-semibold leading-[1.02] text-white sm:text-5xl">
                Activa tu próximo paquete
              </h2>
              <p className="mt-4 max-w-sm text-base leading-7 text-zinc-300">
                Elige la opción que mejor se adapte a tus clases en Demeter.
              </p>
              <div className="mt-auto pt-6">
                <Link
                  href="/student/paquete"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-3 text-base font-semibold text-white shadow-[0_12px_34px_rgba(255,10,138,0.25)] transition hover:bg-fuchsia-500 sm:w-auto sm:min-w-52"
                >
                  Ver paquetes <span aria-hidden="true">→</span>
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link
          href={technicalAction.href}
          data-home-block="technical-level"
          className="group relative overflow-hidden rounded-[1.5rem] border border-fuchsia-500/20 bg-[radial-gradient(circle_at_18%_16%,rgba(255,10,138,0.14),transparent_34%),linear-gradient(145deg,#171421,#0d0f17)] p-4 transition hover:border-fuchsia-400/40 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fuchsia-500/12 text-fuchsia-300">
              <HomeIcon kind="technical" />
            </span>
            <span className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300">›</span>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Nivel técnico</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-white">{technicalSummary}</h2>
          {primaryTechnicalLevel ? (
            <p className="mt-1 truncate text-xs text-zinc-600">
              {primaryTechnicalLevel.disciplineName}
              {additionalTechnicalLevels > 0 ? ` · +${additionalTechnicalLevels}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-600">{technicalAction.label}</p>
          )}
        </Link>

        <Link
          href={
            rewardStatus?.access_unlocked
              ? "/student/recompensas/medallero"
              : "/student/recompensas"
          }
          data-home-block="medal"
          className="group relative overflow-hidden rounded-[1.5rem] border bg-[linear-gradient(145deg,#171421,#0d0f17)] p-4 transition hover:bg-white/[0.04] sm:p-5"
          style={{
            borderColor: currentMedal ? medalVisual.border : "rgba(255,255,255,0.1)",
            backgroundImage: currentMedal
              ? `radial-gradient(circle at 85% 82%, ${medalVisual.wash}, transparent 38%)`
              : undefined,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-black/20 text-lg"
              style={{
                color: currentMedal ? medalVisual.accent : "#a1a1aa",
                borderColor: currentMedal ? medalVisual.border : "rgba(255,255,255,0.1)",
              }}
            >
              ◆
            </span>
            <span className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300">›</span>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Medalla actual</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-white">{medalSummary}</h2>
          <p className="mt-1 text-xs text-zinc-600">Beneficios y constancia</p>
        </Link>
      </section>

      <section
        data-home-block="week-calendar"
        className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(145deg,#11141d,#0c0e15)] p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{currentMonthLabel}</h2>
          <Link
            href="/student/reservar"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 text-sm font-semibold text-zinc-300 transition hover:border-fuchsia-400/35 hover:text-white"
          >
            Ver calendario <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {calendarDays.map((day) => {
            const selected = day.key === today;

            return (
              <Link
                key={day.key}
                href={`/student/reservar?date=${day.key}`}
                className={`flex min-h-16 flex-col items-center justify-center rounded-2xl border text-center transition ${
                  selected
                    ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-white shadow-[0_0_24px_rgba(255,10,138,0.16)]"
                    : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.03]"
                }`}
              >
                <span className="text-[10px] font-semibold">{day.label}</span>
                <strong className="mt-1 text-base">{day.day}</strong>
                <span
                  aria-hidden="true"
                  className={`mt-1 h-1.5 w-1.5 rounded-full ${selected ? "bg-fuchsia-300" : "bg-zinc-700"}`}
                />
              </Link>
            );
          })}
        </div>
      </section>

      <Link
        href="/student/paquete"
        data-home-block="package"
        className={`group block rounded-[1.5rem] border bg-[linear-gradient(145deg,#16131e,#0d0f16)] p-4 transition sm:p-5 ${
          expiresSoon
            ? "border-amber-400/25 hover:border-amber-300/40"
            : "border-fuchsia-500/15 hover:border-fuchsia-400/35"
        }`}
      >
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-300">
            <HomeIcon kind="package" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">Mi paquete</p>
                <p className="mt-0.5 text-sm text-zinc-400">{packageSummary}</p>
              </div>
              <span className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300">
                ›
              </span>
            </div>

            {activePackage && !activePackage.unlimited && activePackage.credit_limit ? (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-400"
                    style={{ width: `${packageUsagePercent}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-zinc-600">
                  <span>{activePackage.used_credits} usadas</span>
                  <span>{activePackage.credit_limit} en total</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Link>

      {followingClass ? (
        <Link
          href="/student/mis-clases"
          data-home-block="following-class"
          className="group flex items-center gap-4 rounded-[1.5rem] border border-white/10 bg-[linear-gradient(145deg,#12141d,#0d0f16)] p-4 transition hover:border-fuchsia-400/30 sm:p-5"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/20 bg-[radial-gradient(circle,rgba(255,10,138,0.22),transparent_65%)] text-fuchsia-200">
            <HomeIcon kind="classes" className="h-7 w-7" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-zinc-500">Siguiente clase</span>
            <strong className="mt-0.5 block truncate text-base font-semibold text-white">
              {followingClass.activity}
            </strong>
            <span className="mt-1 block truncate text-sm text-zinc-500">
              {formatDateTime(followingClass.starts_at, studio.timezone)}
            </span>
          </span>
          <span className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300">›</span>
        </Link>
      ) : (
        <Link
          href="/student/reservar"
          data-home-block="following-class"
          className="group flex min-h-20 items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 bg-[linear-gradient(145deg,#12141d,#0d0f16)] p-4 transition hover:border-fuchsia-400/30"
        >
          <span>
            <span className="block text-xs text-zinc-500">Siguiente clase</span>
            <strong className="mt-1 block text-base font-semibold text-white">
              ¿Quieres agregar otra?
            </strong>
          </span>
          <span className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300">›</span>
        </Link>
      )}
    </main>
  );
}
