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
  maintenance_attendance?: number;
  promotion_attendance?: number;
  min_active_months?: number;
  max_uncovered_days?: number;
  waitlist_priority?: number;
  private_discount_pct?: number;
  event_discount_pct?: number;
  monthly_guest_invites?: number;
};

type RewardLevelDefinitionRow = RewardLevelView & {
  level_key: string;
  level_order: number;
};

type RewardStatusSnapshot = {
  level_title?: string | null;
  attendance_count?: number;
  maintenance_met?: boolean;
  current_level?: RewardLevelView | null;
  next_level?: RewardLevelView | null;
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

type StudentEvaluationsHomeSnapshot = {
  disciplines?: EvaluationHomeCard[];
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
          "level_key,level_order,title,maintenance_attendance,promotion_attendance,min_active_months,max_uncovered_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites",
        )
        .eq("studio_id", membership.studio_id)
        .order("level_order"),
      supabase.rpc("student_reward_invitation_balance"),
      supabase.rpc("student_evaluations_snapshot"),
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
  const levelDefinitions = (rewardLevelsResult.data ?? []) as RewardLevelDefinitionRow[];
  const fallbackLevelKey = rewardMembershipResult.data?.current_level_key ?? null;
  const fallbackLevelRow =
    levelDefinitions.find((level) => level.level_key === fallbackLevelKey) ?? null;
  const fallbackNextRow = fallbackLevelRow
    ? (levelDefinitions.find((level) => level.level_order === fallbackLevelRow.level_order + 1) ??
      null)
    : null;
  const toLevelView = (row: RewardLevelDefinitionRow | null): RewardLevelView | null =>
    row
      ? {
          key: row.level_key,
          title: row.title,
          maintenance_attendance: row.maintenance_attendance,
          promotion_attendance: row.promotion_attendance,
          min_active_months: row.min_active_months,
          max_uncovered_days: row.max_uncovered_days,
          waitlist_priority: row.waitlist_priority,
          private_discount_pct: row.private_discount_pct,
          event_discount_pct: row.event_discount_pct,
          monthly_guest_invites: row.monthly_guest_invites,
        }
      : null;
  const currentLevel = rewardStatus?.current_level ?? toLevelView(fallbackLevelRow);
  const nextLevel = rewardStatus?.next_level ?? toLevelView(fallbackNextRow);
  const attendanceCount = rewardStatus?.attendance_count ?? snapshot.stats.attended_this_month ?? 0;
  const maintenanceTarget = currentLevel?.maintenance_attendance ?? 0;
  const promotionTarget = nextLevel?.promotion_attendance ?? 0;
  const maintenanceProgress = maintenanceTarget
    ? Math.min(100, Math.round((attendanceCount / maintenanceTarget) * 100))
    : 100;
  const promotionProgress = promotionTarget
    ? Math.min(100, Math.round((attendanceCount / promotionTarget) * 100))
    : 100;
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
          eyebrow={`Nivel ${currentLevel.title ?? rewardStatus?.level_title ?? ""}`}
          title="Tus beneficios"
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
                    ? "prioridad base"
                    : `prioridad ${currentLevel.title}`}
                </p>
                <p>Clases privadas · {currentLevel.private_discount_pct ?? 0}% de descuento</p>
                <p>Eventos elegibles · {currentLevel.event_discount_pct ?? 0}% de descuento</p>
                <p>
                  Invitaciones ·{" "}
                  {(currentLevel.monthly_guest_invites ?? 0) > 0
                    ? `${invitationBalance?.remaining ?? currentLevel.monthly_guest_invites} de ${
                        invitationBalance?.total ?? currentLevel.monthly_guest_invites
                      } disponibles este mes`
                    : "sin invitaciones"}
                </p>
              </div>
            </div>
            {nextLevel ? (
              <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                  Siguiente nivel · {nextLevel.title}
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  {nextLevel.private_discount_pct}% en privadas · {nextLevel.event_discount_pct}% en
                  eventos
                  {(nextLevel.monthly_guest_invites ?? 0) > 0
                    ? ` · ${nextLevel.monthly_guest_invites} invitación${nextLevel.monthly_guest_invites === 1 ? "" : "es"} al mes`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                Nivel máximo. Mantén tu constancia para conservar Diamante.
              </p>
            )}
          </div>
        </StudentNoticeDialog>
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
              {activeEvaluationInvitation.window_start &&
              activeEvaluationInvitation.window_end ? (
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
                : "/student/evaluaciones/" +
                  activeEvaluationInvitation.invitation_id +
                  "/programar"
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
        data-home-block="identity-level"
        data-level={levelKey}
        className="relative overflow-hidden rounded-[28px] border p-4 transition-colors sm:p-5"
        style={{
          borderColor: levelVisual.border,
          boxShadow: `0 0 34px ${levelVisual.glow}, inset 0 0 0 1px rgba(255,255,255,0.025)`,
          backgroundImage: `radial-gradient(circle at 82% 12%, ${levelVisual.wash}, transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))`,
        }}
      >
        <div className="grid grid-cols-[0.88fr_1.12fr] gap-4">
          <div
            className="flex min-w-0 flex-col justify-between border-r pr-4"
            style={{ borderColor: levelVisual.divider }}
          >
            <div>
              <div
                className="relative mx-auto h-44 w-full max-w-[160px] overflow-hidden rounded-[24px] border-2 bg-black/20 sm:h-52 sm:max-w-[190px]"
                style={{
                  borderColor: levelVisual.accent,
                  boxShadow: `0 0 30px ${levelVisual.glow}`,
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
            </div>

            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
                Mi perfil
              </p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">
                {fullName}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">Movimiento que transforma</p>
            </div>
          </div>

          <div
            className="min-w-0 rounded-3xl border bg-black/20 p-3.5 sm:p-4"
            style={{ borderColor: levelVisual.divider }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
                  Mi nivel
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border text-2xl"
                    style={{
                      borderColor: levelVisual.border,
                      background: `linear-gradient(135deg, ${levelVisual.wash}, rgba(0,0,0,0.18))`,
                      boxShadow: `0 0 24px ${levelVisual.glow}`,
                      color: levelVisual.accent,
                    }}
                  >
                    ♛
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold text-white">
                      {currentLevel?.title ?? "Bronce"}
                    </h2>
                    <p className="mt-0.5 text-xs leading-4 text-zinc-400">
                      Tu constancia te lleva más lejos
                    </p>
                  </div>
                </div>
              </div>
              <span aria-hidden="true" className="text-xl text-zinc-600">
                ›
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-zinc-200">
                    Mantener {currentLevel?.title ?? "Bronce"}
                  </span>
                  <span className="font-semibold text-white">
                    {attendanceCount} / {maintenanceTarget}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${maintenanceProgress}%` }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-zinc-200">
                    {nextLevel ? `Camino a ${nextLevel.title}` : "Nivel máximo"}
                  </span>
                  <span className="font-semibold text-white">
                    {nextLevel ? `${attendanceCount} / ${promotionTarget}` : "✓"}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${nextLevel ? promotionProgress : 100}%` }}
                  />
                </div>
              </div>
            </div>

            <Link
              href="/student?benefits=1"
              className="mt-3 flex min-h-11 items-center justify-between gap-3 border-t border-white/10 pt-3 text-sm font-semibold text-white"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="text-xl text-fuchsia-400">
                  ♡
                </span>
                Ver mis beneficios
              </span>
              <span aria-hidden="true" className="text-xl text-zinc-600">
                ›
              </span>
            </Link>
          </div>
        </div>
      </header>

      {activePackage ? (
        <section
          data-home-block="package"
          data-density="compact"
          className="rounded-2xl border border-white/10 bg-white/[0.025] px-3.5 py-2.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <p className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Mi paquete
                </p>
                <h2 className="truncate text-sm font-semibold text-white">{activePackage.name}</h2>
              </div>
            </div>
            <Link
              href="/student/paquete"
              className="shrink-0 text-[11px] font-semibold text-zinc-400 transition hover:text-fuchsia-300"
            >
              Ver detalles
            </Link>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <p className="min-w-0 truncate text-zinc-400">
              <strong className="font-semibold text-white">
                {compactPackageHeadline}
                {activePackage.unlimited ? (
                  <span className="font-normal text-zinc-500"> · Acceso durante tu vigencia</span>
                ) : null}
              </strong>
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">Vence</span>
              <span className={`font-semibold ${expiresSoon ? "text-amber-200" : "text-zinc-300"}`}>
                {formatDate(activePackage.expires_on, studio.timezone)}
              </span>
              {expiresSoon ? (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                  Pronto
                </span>
              ) : null}
            </div>
          </div>

          {activePackage.unlimited ? (
            <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-zinc-500">
              Reservas sujetas a disponibilidad y reglas vigentes.
            </p>
          ) : (
            <div className="mt-2">
              <div
                className="h-1 overflow-hidden rounded-full bg-white/10"
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
              <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-600">
                <span>{activePackage.used_credits} utilizadas</span>
                <span>{packageLimit} total</span>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section
        data-home-block="next-class"
        data-density="compact"
        className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
            Tu próxima clase
          </p>
          {nextClass ? (
            <Link href="/student/mis-clases" className="text-xs font-semibold text-fuchsia-300">
              Ver todas
            </Link>
          ) : null}
        </div>

        {nextClass ? (
          <Link
            href="/student/mis-clases"
            className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3 transition hover:bg-white/[0.04]"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-white">
                  {nextClass.activity}
                </h2>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Confirmada
                </span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-fuchsia-300">{nextClass.discipline}</p>
              <p className="mt-1.5 text-xs text-zinc-300">
                {formatDateTime(nextClass.starts_at, studio.timezone)}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {[nextClass.space, nextClass.coach].filter(Boolean).join(" · ") ||
                  "Consulta los detalles de tu clase"}
              </p>
            </div>
            <span aria-hidden="true" className="text-xl text-zinc-500">
              ›
            </span>
          </Link>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/15 px-4 py-4 text-center">
            <h2 className="text-sm font-semibold text-white">
              {noCredits
                ? "No tienes clases reservadas"
                : activePackage
                  ? "Aún no tienes clases reservadas"
                  : "No tienes clases reservadas"}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-400">
              {noCredits
                ? "Tu paquete ya no tiene clases disponibles."
                : activePackage
                  ? "Tu próxima reserva aparecerá aquí."
                  : "Adquiere un paquete para comenzar a reservar."}
            </p>
            <Link
              href={canReserve ? "/student/reservar" : "/student/paquete"}
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
            >
              {canReserve ? "Reservar clase" : "Ver paquetes"}
            </Link>
          </div>
        )}
      </section>

      {!activePackage ? (
        <section
          data-home-block="no-package"
          data-density="compact"
          className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Mi paquete
          </p>
          <h2 className="mt-2 text-base font-semibold text-white">No tienes un paquete activo</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-400">
            Consulta los paquetes disponibles para seguir entrenando.
          </p>
          <Link
            href="/student/paquete"
            className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver paquetes
          </Link>
        </section>
      ) : null}

      <Link
        href="/student/recompensas"
        data-home-block="progress"
        className="group flex min-h-20 items-center justify-between gap-4 rounded-3xl border border-fuchsia-500/20 bg-[radial-gradient(circle_at_88%_15%,rgba(236,72,153,0.14),transparent_34%),rgba(255,255,255,0.03)] px-4 py-3.5 transition hover:border-fuchsia-400/35 hover:bg-fuchsia-500/[0.06]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
          >
            ✦
          </span>
          <span className="min-w-0">
            <strong className="block text-sm font-semibold text-white">Mi progreso</strong>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Metas, rachas, logros y recompensas
            </span>
          </span>
        </div>
        <span
          aria-hidden="true"
          className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
        >
          ›
        </span>
      </Link>

      <section data-home-block="quick-actions">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Acciones rápidas
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Link
            href="/student/reservar"
            className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] px-2 py-2 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-base text-fuchsia-300">
              ◫
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white sm:text-xs">
              Reservar
            </span>
          </Link>
          <Link
            href="/student/mis-clases"
            className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] px-2 py-2 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-base text-fuchsia-300">
              ≡
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white sm:text-xs">
              Mis clases
            </span>
          </Link>
          <Link
            href="/student/paquete"
            className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.07] px-2 py-2 text-center transition hover:bg-fuchsia-500/[0.12]"
          >
            <span aria-hidden="true" className="text-base text-fuchsia-300">
              ▭
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white sm:text-xs">
              Mi paquete
            </span>
          </Link>
        </div>
      </section>

      <section
        data-density="compact"
        className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_85%_20%,rgba(236,72,153,0.12),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
            Disciplina también es amor propio
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
          <div>
            <strong className="block text-lg text-white">
              {snapshot.stats.attended_this_month}
            </strong>
            <span className="text-[11px] text-zinc-500">este mes</span>
          </div>
          <div>
            <strong className="block text-lg text-white">{snapshot.stats.attended_total}</strong>
            <span className="text-[11px] text-zinc-500">asistencias</span>
          </div>
          <div>
            <strong className="block text-lg text-white">{snapshot.stats.streak_days}</strong>
            <span className="text-[11px] text-zinc-500">racha</span>
          </div>
        </div>
      </section>
    </main>
  );
}
