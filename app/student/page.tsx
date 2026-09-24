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
    border: "rgba(205,127,50,0.58)",
    wash: "rgba(205,127,50,0.1)",
  },
  silver: {
    accent: "#C0C0C0",
    border: "rgba(192,192,192,0.56)",
    wash: "rgba(192,192,192,0.08)",
  },
  gold: {
    accent: "#D4AF37",
    border: "rgba(212,175,55,0.62)",
    wash: "rgba(212,175,55,0.1)",
  },
  diamond: {
    accent: "#5EDFFF",
    border: "rgba(94,223,255,0.64)",
    wash: "rgba(94,223,255,0.1)",
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

  const rewardClassWallets = snapshot.acquisitions.filter(
    (item) => item.reward_credit_wallet && item.status === "active" && item.active_now,
  );
  const packageAcquisitions = snapshot.acquisitions.filter((item) => !item.reward_credit_wallet);
  const activePackage = packageAcquisitions.find((item) => item.active_now) ?? null;
  const classesAvailable = availableClasses(activePackage);
  const extraClassesAvailable = rewardClassWallets.reduce(
    (total, item) => total + (item.available_credits ?? 0),
    0,
  );
  const nearestExtraClassExpiry =
    rewardClassWallets
      .map((item) => item.expires_on)
      .filter(Boolean)
      .sort()[0] ?? null;

  const nextClass =
    [...snapshot.upcoming].sort(
      (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
    )[0] ?? null;

  const today = localDateKey(new Date(), studio.timezone);
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
          label: "Ver evaluaciones",
          href: "/student/evaluaciones",
        };

  return (
    <main className="space-y-4 pb-4">
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

      <header className="pb-1">
        <p className="student-eyebrow">Inicio</p>
        <h1 className="student-page-title mt-1">Hola, {snapshot.profile.first_name}</h1>
        <p className="student-body mt-2">Aquí tienes lo importante para tu próximo entrenamiento.</p>
      </header>

      {priorityNotification ? (
        (() => {
          const tone = priorityNotificationTone(priorityNotification.notification_type);

          return (
            <section
              data-home-block="priority-action"
              className={`student-card ${tone.border} ${tone.background} p-4`}
            >
              <p className={`text-xs font-semibold ${tone.label}`}>Importante</p>
              <h2 className="mt-2 text-lg font-semibold text-white">
                {priorityNotification.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-zinc-300">
                {priorityNotification.body}
              </p>
              <Link
                href={`/student/notificaciones/${priorityNotification.id}`}
                className={`mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold ${tone.button}`}
              >
                Ver detalle
              </Link>
            </section>
          );
        })()
      ) : primaryRestriction ? (
        <section
          data-home-block="priority-action"
          className="student-card border-amber-400/30 bg-amber-400/[0.055] p-4"
        >
          <p className="text-xs font-semibold text-amber-200">Necesitas resolver esto</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{primaryRestriction.title}</h2>
          {primaryRestriction.detail ? (
            <p className="mt-1 text-sm leading-6 text-zinc-300">{primaryRestriction.detail}</p>
          ) : null}
          {primaryRestriction.action_href ? (
            <Link
              href={primaryRestriction.action_href}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
            >
              {primaryRestriction.action_label || "Resolver"}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section data-home-block="next-class" className="student-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="student-eyebrow">Tu próxima clase</p>
            {nextClass ? (
              <h2 className="mt-1 text-xl font-semibold text-white">{nextClass.activity}</h2>
            ) : null}
          </div>
          {nextClass ? (
            <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              Confirmada
            </span>
          ) : null}
        </div>

        {nextClass ? (
          <>
            <p className="mt-3 text-base font-medium text-white">
              {formatDateTime(nextClass.starts_at, studio.timezone)}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {[nextClass.coach, nextClass.space].filter(Boolean).join(" · ") ||
                "Consulta los detalles de tu clase"}
            </p>
            <Link
              href="/student/mis-clases"
              className="student-action-secondary mt-4 w-full sm:w-auto"
            >
              Ver mi clase
            </Link>
          </>
        ) : (
          <div className="mt-3">
            <h2 className="text-lg font-semibold text-white">Reserva tu próxima clase</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Elige el día y la clase que quieres tomar.
            </p>
            <Link href="/student/reservar" className="student-action-primary mt-4 w-full sm:w-auto">
              Reservar una clase
            </Link>
          </div>
        )}
      </section>

      <section
        data-home-block="package"
        className={`student-card p-4 sm:p-5 ${
          expiresSoon ? "border-amber-400/30 bg-amber-400/[0.035]" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="student-eyebrow">Tu paquete</p>
            {activePackage ? (
              <>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  {activePackage.unlimited
                    ? "Clases ilimitadas"
                    : `${classesAvailable ?? 0} clases disponibles`}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {activePackage.name} · vence {formatDate(activePackage.expires_on, studio.timezone)}
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-1 text-lg font-semibold text-white">No tienes un paquete activo</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Necesitas un paquete o clase disponible para seguir reservando.
                </p>
              </>
            )}
          </div>
          {activePackage ? (
            <Link href="/student/paquete" className="shrink-0 text-sm font-semibold text-fuchsia-300">
              Ver →
            </Link>
          ) : null}
        </div>

        {activePackage && extraClassesAvailable > 0 ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] px-3.5 py-3">
            <strong className="text-sm text-emerald-200">
              +{extraClassesAvailable} {extraClassesAvailable === 1 ? "clase extra" : "clases extra"}
            </strong>
            {nearestExtraClassExpiry ? (
              <p className="mt-0.5 text-xs text-zinc-400">
                Disponibles hasta {formatDate(nearestExtraClassExpiry, studio.timezone)}
              </p>
            ) : null}
          </div>
        ) : null}

        {!activePackage ? (
          <Link href="/student/paquete" className="student-action-primary mt-4 w-full sm:w-auto">
            Ver paquetes
          </Link>
        ) : null}
      </section>

      <section data-home-block="technical-level" className="student-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="student-eyebrow">Nivel técnico</p>

            {latestPublishedEvaluation ? (
              <>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {latestPublishedEvaluation.discipline_name}
                </h2>
                <p className="mt-1 text-sm text-zinc-300">
                  Resultado disponible
                  {latestPublishedEvaluation.resulting_level_title
                    ? ` · ${latestPublishedEvaluation.resulting_level_title}`
                    : ""}
                </p>
              </>
            ) : activeEvaluationInvitation ? (
              <>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {activeEvaluationInvitation.discipline_name}
                </h2>
                <p className="mt-1 text-sm text-zinc-300">
                  {activeEvaluationInvitation.invitation_status === "offered"
                    ? "Tienes una evaluación disponible"
                    : "Elige una clase para realizar tu evaluación"}
                </p>
              </>
            ) : primaryTechnicalLevel ? (
              <>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {primaryTechnicalLevel.disciplineName}
                </h2>
                <p className="mt-1 text-base font-semibold text-cyan-200">
                  {primaryTechnicalLevel.levelTitle}
                </p>
                {additionalTechnicalLevels > 0 ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    +{additionalTechnicalLevels}{" "}
                    {additionalTechnicalLevels === 1 ? "disciplina" : "disciplinas"}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Aún sin nivel técnico confirmado
                </h2>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  Tu nivel se confirma por disciplina mediante Evaluaciones.
                </p>
              </>
            )}
          </div>

          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-200"
          >
            ◎
          </span>
        </div>

        <Link href={technicalAction.href} className="student-action-secondary mt-4 w-full sm:w-auto">
          {technicalAction.label}
        </Link>
      </section>

      <section
        data-home-block="medal"
        className="student-card p-4 sm:p-5"
        style={
          currentMedal
            ? {
                borderColor: medalVisual.border,
                backgroundImage: `radial-gradient(circle at 92% 8%, ${medalVisual.wash}, transparent 34%)`,
              }
            : undefined
        }
      >
        <div className="flex items-start gap-4">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] text-xl"
            style={currentMedal ? { color: medalVisual.accent, borderColor: medalVisual.border } : undefined}
          >
            ◇
          </div>

          <div className="min-w-0 flex-1">
            <p className="student-eyebrow">Tu medalla</p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {currentMedal
                ? `Medalla ${currentMedal.title ?? "Bronce"}`
                : rewardStatus?.access_unlocked
                  ? "Sin medalla este mes"
                  : "Activa tus Medallas"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              {currentMedal
                ? "Reconoce tu constancia y desbloquea beneficios en Demeter."
                : rewardStatus?.access_unlocked
                  ? "Tus requisitos de medalla se evalúan cada mes."
                  : "Completa tu activación para empezar a obtener medallas y beneficios."}
            </p>
          </div>
        </div>

        <Link
          href={
            rewardStatus?.access_unlocked
              ? "/student/recompensas/medallero"
              : "/student/recompensas"
          }
          className="student-action-secondary mt-4 w-full sm:w-auto"
        >
          {currentMedal
            ? "Ver medallas y beneficios"
            : rewardStatus?.access_unlocked
              ? "Ver Medallero"
              : "Continuar activación"}
        </Link>
      </section>
    </main>
  );
}
