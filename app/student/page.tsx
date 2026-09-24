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
  active_days?: number;
  no_show_count?: number;
  continuity_months?: number;
  renewal_gap_days?: number;
  current_medal?: RewardLevelView | null;
  current_level?: RewardLevelView | null;
};

type RewardInvitationBalance = {
  total?: number;
  used?: number;
  remaining?: number;
  level_title?: string | null;
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

const levelVisuals = {
  bronze: {
    accent: "#CD7F32",
    border: "rgba(205,127,50,0.72)",
    divider: "rgba(205,127,50,0.34)",
    glow: "rgba(205,127,50,0.22)",
    wash: "rgba(205,127,50,0.12)",
  },
  silver: {
    accent: "#C0C0C0",
    border: "rgba(192,192,192,0.72)",
    divider: "rgba(192,192,192,0.32)",
    glow: "rgba(192,192,192,0.18)",
    wash: "rgba(192,192,192,0.10)",
  },
  gold: {
    accent: "#D4AF37",
    border: "rgba(212,175,55,0.76)",
    divider: "rgba(212,175,55,0.34)",
    glow: "rgba(212,175,55,0.22)",
    wash: "rgba(212,175,55,0.12)",
  },
  diamond: {
    accent: "#5EDFFF",
    border: "rgba(94,223,255,0.78)",
    divider: "rgba(94,223,255,0.36)",
    glow: "rgba(94,223,255,0.24)",
    wash: "rgba(94,223,255,0.12)",
  },
} as const;

function dateDistanceInDays(from: string, to: string) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function availableCredits(activePackage: StudentAcquisition | null) {
  if (!activePackage || activePackage.unlimited) return null;
  return activePackage.available_credits ?? 0;
}

function unlimitedPackageLabel(activePackage: StudentAcquisition) {
  return activePackage.unlimited ? "Ilimitado" : "";
}

function creditLimit(activePackage: StudentAcquisition) {
  if (activePackage.credit_limit && activePackage.credit_limit > 0) {
    return activePackage.credit_limit;
  }

  return (
    (activePackage.available_credits ?? 0) +
    activePackage.reserved_credits +
    activePackage.used_credits
  );
}

export default async function StudentHomePage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string; benefits?: string }>;
}) {
  const query = await searchParams;
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();
  const [
    rewardStatusResult,
    rewardMembershipResult,
    rewardLevelsResult,
    invitationBalanceResult,
    evaluationsResult,
    unreadEvaluationResult,
    appNotificationResult,
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
    supabase.rpc("student_reward_invitation_balance"),
    supabase.rpc("student_evaluations_snapshot"),
    supabase.rpc("student_latest_unread_evaluation_result"),
    supabase
      .from("app_notifications")
      .select("id,title,body,notification_type,created_at,payload")
      .eq("student_id", snapshot.profile.student_id)
      .eq("recipient_kind", "student")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rewardStatus = (rewardStatusResult.data as RewardStatusSnapshot | null) ?? null;
  const invitationBalance =
    (invitationBalanceResult.data as RewardInvitationBalance | null) ?? null;
  const evaluationsSnapshot =
    (evaluationsResult.data as StudentEvaluationsHomeSnapshot | null) ?? null;
  const activeEvaluationInvitation =
    evaluationsSnapshot?.disciplines?.find(
      (item) =>
        item.invitation_id &&
        (item.invitation_status === "offered" || item.invitation_status === "pending_schedule"),
    ) ?? null;
  const latestPublishedEvaluation =
    (unreadEvaluationResult.data as EvaluationHomeHistoryItem | null) ?? null;
  const latestAppNotification =
    (appNotificationResult.data as AppNotificationHomeItem | null) ?? null;

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
  const currentLevel =
    rewardStatus?.current_medal ?? rewardStatus?.current_level ?? toLevelView(fallbackLevelRow);
  const levelKey =
    currentLevel?.key === "silver" ||
    currentLevel?.key === "gold" ||
    currentLevel?.key === "diamond"
      ? currentLevel.key
      : "bronze";
  const levelVisual = levelVisuals[levelKey];
  const fullName = [snapshot.profile.first_name, snapshot.profile.last_name]
    .filter(Boolean)
    .join(" ");
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const credits = availableCredits(activePackage);
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

  const packageLimit = activePackage ? creditLimit(activePackage) : 0;
  const usedProgress =
    activePackage && !activePackage.unlimited && packageLimit > 0
      ? Math.min(100, Math.round((activePackage.used_credits / packageLimit) * 100))
      : 0;

  const noCredits = Boolean(activePackage && !activePackage.unlimited && credits === 0);
  const canReserve = Boolean(activePackage && (activePackage.unlimited || (credits ?? 0) > 0));
  const compactPackageHeadline = activePackage
    ? activePackage.unlimited
      ? "Ilimitado"
      : `${credits} clases disponibles`
    : "";

  return (
    <main className="space-y-3 pb-4 sm:space-y-4">
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

      {query.benefits === "1" && currentLevel ? (
        <StudentNoticeDialog
          eyebrow={`Medalla ${currentLevel.title ?? rewardStatus?.medal_title ?? ""}`}
          title="Mis recompensas"
          dismissHref="/student"
          confirmLabel="Cerrar"
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <p className="font-semibold text-white">Beneficios activos este mes</p>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                <p>
                  Lista de espera ·{" "}
                  {currentLevel.title === "Bronce"
                    ? "prioridad básica"
                    : currentLevel.title === "Plata"
                      ? "prioridad mayor"
                      : currentLevel.title === "Oro"
                        ? "prioridad alta"
                        : "prioridad máxima"}
                </p>
                {(currentLevel.event_discount_pct ?? 0) > 0 ? (
                  <p>Eventos elegibles · {currentLevel.event_discount_pct}% de descuento</p>
                ) : null}
                {(currentLevel.private_discount_pct ?? 0) > 0 ? (
                  <p>Clases privadas · {currentLevel.private_discount_pct}% de descuento</p>
                ) : null}
                {(currentLevel.monthly_guest_invites ?? 0) > 0 ? (
                  <p>
                    Invitaciones ·{" "}
                    {`${invitationBalance?.remaining ?? currentLevel.monthly_guest_invites} de ${
                      invitationBalance?.total ?? currentLevel.monthly_guest_invites
                    } disponibles este mes`}
                  </p>
                ) : null}
                {currentLevel.key !== "bronze" ? (
                  <p>Acceso anticipado · inscripciones y promociones especiales</p>
                ) : null}
                {currentLevel.key === "diamond" ? (
                  <p>Experiencias premium · beneficios exclusivos de Demeter</p>
                ) : null}
              </div>
            </div>

            <Link
              href="/student/recompensas/medallero"
              className="flex min-h-12 items-center justify-between rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500/[0.1]"
            >
              <span>Ver Medallero</span>
              <span aria-hidden="true" className="text-lg text-fuchsia-300">
                ›
              </span>
            </Link>
          </div>
        </StudentNoticeDialog>
      ) : null}

      {latestAppNotification?.notification_type === "session_minimum_cancelled" ? (
        <section
          data-home-block="minimum-cancellation-notification"
          className="relative overflow-hidden rounded-[26px] border border-rose-500/35 bg-[radial-gradient(circle_at_88%_0%,rgba(244,63,94,0.18),transparent_38%),rgba(255,255,255,0.025)] p-4 shadow-[0_0_28px_rgba(244,63,94,0.08)] sm:p-5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-fuchsia-500"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex rounded-full border border-rose-400/30 bg-rose-400/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-rose-200">
                Clase cancelada
              </span>
              <h2 className="mt-3 text-lg font-semibold text-white">
                {latestAppNotification.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-zinc-300">{latestAppNotification.body}</p>
            </div>
            <span aria-hidden="true" className="text-2xl text-rose-300">
              ×
            </span>
          </div>

          <Link
            href={`/student/notificaciones/${latestAppNotification.id}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-rose-400/25 bg-rose-500/[0.1] px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/[0.16]"
          >
            Ver detalle
          </Link>
        </section>
      ) : null}

      {latestPublishedEvaluation ? (
        <section
          data-home-block="evaluation-result"
          className="relative overflow-hidden rounded-[26px] border border-fuchsia-500/45 bg-[radial-gradient(circle_at_88%_0%,rgba(236,72,153,0.24),transparent_36%),linear-gradient(135deg,rgba(236,72,153,0.12),rgba(124,58,237,0.07))] p-4 shadow-[0_0_30px_rgba(236,72,153,0.1)] sm:p-5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span
                className={
                  "inline-flex rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] " +
                  (latestPublishedEvaluation.final_outcome === "approved"
                    ? "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-300"
                    : "border-amber-400/35 bg-amber-400/[0.08] text-amber-300")
                }
              >
                Resultado disponible
              </span>
              <h2 className="mt-3 text-lg font-semibold text-white">Resultado de tu evaluación</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                {latestPublishedEvaluation.discipline_name}
                {latestPublishedEvaluation.evaluated_level_title
                  ? ` · ${latestPublishedEvaluation.evaluated_level_title}`
                  : ""}
                {latestPublishedEvaluation.total_score !== null
                  ? ` · ${Math.round(latestPublishedEvaluation.total_score)}%`
                  : ""}
              </p>
            </div>
            <span aria-hidden="true" className="text-2xl text-fuchsia-300">
              ✦
            </span>
          </div>

          <Link
            href={"/student/evaluaciones/resultado/" + latestPublishedEvaluation.id}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver resultado de tu evaluación
          </Link>
        </section>
      ) : null}
      {activeEvaluationInvitation?.invitation_id ? (
        <section
          data-home-block="evaluation-invitation"
          className="relative overflow-hidden rounded-[26px] border border-fuchsia-500/40 bg-[radial-gradient(circle_at_88%_0%,rgba(236,72,153,0.22),transparent_36%),linear-gradient(135deg,rgba(236,72,153,0.11),rgba(124,58,237,0.06))] p-4 shadow-[0_0_28px_rgba(236,72,153,0.08)] sm:p-5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex rounded-full border border-fuchsia-500/30 bg-fuchsia-500/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                {activeEvaluationInvitation.invitation_status === "offered"
                  ? "Evaluación disponible"
                  : "Evaluación pendiente"}
              </span>
              <h2 className="mt-3 text-lg font-semibold text-white">
                {activeEvaluationInvitation.discipline_name}
              </h2>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                {activeEvaluationInvitation.invitation_status === "offered"
                  ? `Tienes una invitación para evaluar tu nivel ${activeEvaluationInvitation.current_level_title}.`
                  : "Ya aceptaste tu evaluación. Elige una clase para programarla."}
              </p>
              {activeEvaluationInvitation.window_start && activeEvaluationInvitation.window_end ? (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Disponible del{" "}
                  {formatDate(activeEvaluationInvitation.window_start, studio.timezone)} al{" "}
                  {formatDate(activeEvaluationInvitation.window_end, studio.timezone)}
                </p>
              ) : null}
            </div>
            <span aria-hidden="true" className="text-2xl text-fuchsia-300">
              ✦
            </span>
          </div>

          <Link
            href={
              activeEvaluationInvitation.invitation_status === "offered"
                ? "/student/evaluaciones/" + activeEvaluationInvitation.invitation_id
                : "/student/evaluaciones/" + activeEvaluationInvitation.invitation_id + "/programar"
            }
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            {activeEvaluationInvitation.invitation_status === "offered"
              ? "Ver invitación"
              : "Programar evaluación"}
          </Link>
        </section>
      ) : null}

      <header
        data-home-block="identity-benefits-technical"
        data-level={levelKey}
        className="relative overflow-hidden rounded-[28px] border p-4 transition-colors sm:p-5"
        style={{
          borderColor: levelVisual.border,
          boxShadow: `0 0 34px ${levelVisual.glow}, inset 0 0 0 1px rgba(255,255,255,0.025)`,
          backgroundImage: `radial-gradient(circle at 86% 8%, ${levelVisual.wash}, transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))`,
        }}
      >
        <div className="grid grid-cols-[0.92fr_1.08fr] items-start gap-4">
          <div className="min-w-0">
            <div
              className="relative h-28 w-28 overflow-hidden rounded-full border-2 bg-black/25 sm:h-32 sm:w-32"
              style={{
                borderColor: levelVisual.accent,
                boxShadow: `0 0 28px ${levelVisual.glow}`,
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-fuchsia-200">
                {snapshot.profile.first_name.trim().charAt(0).toUpperCase()}
              </div>
              <Image
                src="/student/perfil/avatar"
                alt="Foto de perfil"
                fill
                unoptimized
                className="object-cover"
              />
            </div>

            <p className="mt-4 text-[9px] font-semibold uppercase tracking-[0.26em] text-zinc-500">
              Mi perfil
            </p>
            <h1 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight text-white sm:text-2xl">
              {fullName}
            </h1>
          </div>

          <Link
            href={
              currentLevel
                ? "/student?benefits=1"
                : rewardStatus?.access_unlocked
                  ? "/student/recompensas/medallero"
                  : "/student/recompensas"
            }
            className="min-w-0 rounded-3xl border bg-black/20 p-3.5 transition hover:bg-white/[0.035] sm:p-4"
            style={{ borderColor: levelVisual.divider }}
          >
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.22em]"
              style={{ color: currentLevel ? levelVisual.accent : "#f0abfc" }}
            >
              {currentLevel ? "Mi medalla" : rewardStatus?.access_unlocked ? "Medallas" : "Rewards"}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border text-xl"
                style={{
                  borderColor: currentLevel ? levelVisual.border : "rgba(236,72,153,0.35)",
                  background: currentLevel
                    ? `linear-gradient(135deg, ${levelVisual.wash}, rgba(0,0,0,0.18))`
                    : "rgba(236,72,153,0.08)",
                  boxShadow: currentLevel ? `0 0 22px ${levelVisual.glow}` : "none",
                  color: currentLevel ? levelVisual.accent : "#f0abfc",
                }}
              >
                {currentLevel ? "♛" : "◇"}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold text-white">
                  {currentLevel
                    ? `Medalla ${currentLevel.title ?? "Bronce"}`
                    : rewardStatus?.access_unlocked
                      ? "Sin medalla"
                      : "Activando Medallas"}
                </h2>
                <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">
                  {currentLevel
                    ? "Tu constancia te lleva más lejos"
                    : rewardStatus?.access_unlocked
                      ? "Tu Medalla se evalúa cada mes"
                      : "Completa tu activación para acceder al programa"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs font-semibold text-white">
              <span>
                {currentLevel
                  ? "Ver mis recompensas"
                  : rewardStatus?.access_unlocked
                    ? "Ver Medallero"
                    : "Continuar activación"}
              </span>
              <span aria-hidden="true" className="text-lg text-zinc-600">
                ›
              </span>
            </div>
          </Link>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
              Niveles técnicos
            </p>
            {technicalLevels.length ? (
              <Link
                href="/student/evaluaciones"
                className="text-[10px] font-semibold text-fuchsia-300"
              >
                Ver evaluaciones →
              </Link>
            ) : null}
          </div>

          {technicalLevels.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {technicalLevels.map((item) => (
                <span
                  key={item.disciplineName}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/[0.06] px-3 py-1.5 text-[11px] font-semibold text-cyan-200"
                >
                  <span>{item.disciplineName}</span>
                  <span className="text-cyan-500">·</span>
                  <strong>{item.levelTitle}</strong>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-3.5 py-3">
              <p className="text-xs text-zinc-400">Aún no tienes niveles técnicos confirmados.</p>
            </div>
          )}
        </div>
      </header>

      {activePackage ? (
        <section
          data-home-block="package"
          className="rounded-[24px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.09),transparent_36%),rgba(255,255,255,0.025)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                Mi paquete
              </p>
              <h2 className="mt-2 truncate text-lg font-semibold text-white">
                {activePackage.name}
              </h2>
            </div>
            <Link href="/student/paquete" className="shrink-0 text-xs font-semibold text-white">
              Ver detalles →
            </Link>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/10 pt-4">
            <div>
              <strong className="block text-base font-semibold text-white">
                {compactPackageHeadline}
              </strong>
              {activePackage.unlimited ? (
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Acceso durante tu vigencia
                </span>
              ) : null}
            </div>
            <div className="text-right">
              <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">Vence</span>
              <strong
                className={`ml-2 text-sm ${expiresSoon ? "text-amber-200" : "text-zinc-300"}`}
              >
                {formatDate(activePackage.expires_on, studio.timezone)}
              </strong>
            </div>
          </div>

          {!activePackage.unlimited ? (
            <div className="mt-3">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Clases utilizadas"
                aria-valuemin={0}
                aria-valuemax={packageLimit}
                aria-valuenow={activePackage.used_credits}
              >
                <div
                  className="h-full rounded-full bg-fuchsia-500"
                  style={{ width: `${usedProgress}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-600">
                <span>{activePackage.used_credits} utilizadas</span>
                <span>{packageLimit} total</span>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section
          data-home-block="no-package"
          className="rounded-[24px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_100%_0%,rgba(236,72,153,0.08),transparent_36%),rgba(255,255,255,0.025)] p-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
            Mi paquete
          </p>
          <div className="mt-5 text-center">
            <span aria-hidden="true" className="text-3xl text-zinc-500">
              ◇
            </span>
            <h2 className="mt-3 text-base font-semibold text-white">
              Aún no tienes un paquete activo
            </h2>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-zinc-400">
              Explora las opciones disponibles y elige la que se adapte a ti.
            </p>
            <Link
              href="/student/paquete"
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Comprar paquete
            </Link>
          </div>
        </section>
      )}

      <section
        data-home-block="reserved-classes"
        className="rounded-[24px] border border-fuchsia-500/25 bg-white/[0.025] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
            Tus clases reservadas
          </p>
          {nextClass ? (
            <Link href="/student/mis-clases" className="text-xs font-semibold text-white">
              Ver todas →
            </Link>
          ) : null}
        </div>

        {nextClass ? (
          <Link
            href="/student/mis-clases"
            className="mt-3 grid grid-cols-[68px_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 transition hover:bg-white/[0.04]"
          >
            <div className="relative h-[76px] overflow-hidden rounded-xl border border-fuchsia-500/25 bg-[radial-gradient(circle_at_45%_25%,rgba(236,72,153,0.45),transparent_24%),linear-gradient(145deg,#2b0b22,#090c12_72%)]">
              <span className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-fuchsia-300/45" />
              <span className="absolute inset-0 grid place-items-center text-lg text-fuchsia-200">
                ✦
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-white">
                  {nextClass.activity}
                </h2>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Confirmada
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-300">
                {formatDateTime(nextClass.starts_at, studio.timezone)}
              </p>
              <p className="mt-1 truncate text-[11px] text-zinc-500">
                {[nextClass.space, nextClass.coach].filter(Boolean).join(" · ") ||
                  "Consulta los detalles de tu clase"}
              </p>
            </div>
            <span aria-hidden="true" className="text-xl text-zinc-500">
              ›
            </span>
          </Link>
        ) : (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-5 text-center">
            <span aria-hidden="true" className="text-2xl text-zinc-500">
              ▣
            </span>
            <h2 className="mt-3 text-sm font-semibold text-white">
              Aún no tienes clases reservadas
            </h2>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-zinc-400">
              Reserva tu próxima clase y sigue avanzando en tu entrenamiento.
            </p>
            <Link
              href="/student/reservar"
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-fuchsia-500/70 px-4 text-sm font-semibold text-fuchsia-300 transition hover:bg-fuchsia-500/[0.08]"
            >
              Reservar clase
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
