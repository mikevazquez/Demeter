import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import { getStudentRewardsContext, rewardBenefitLabel } from "@/lib/student/rewards";

import { MedalsAccessUnlocked, RewardsOnboardingActivation } from "./OnboardingActivation";

type MedalKey = "bronze" | "silver" | "gold" | "diamond";

type MedalDefinition = {
  level_key: MedalKey;
  level_order: number;
  title: string;
  required_active_days: number;
  max_no_shows: number;
  min_continuity_months: number;
  max_renewal_gap_days: number;
  waitlist_priority: number;
  private_discount_pct: number;
  event_discount_pct: number;
  monthly_guest_invites: number;
};

type MedalProgress = {
  active_days?: number;
  no_show_count?: number;
  continuity_months?: number;
  renewal_gap_days?: number;
  active_days_met?: boolean;
  no_show_met?: boolean;
  continuity_met?: boolean;
  renewal_met?: boolean;
};

type MedalStatusSnapshot = {
  access_unlocked?: boolean;
  medal_key?: MedalKey | null;
  medal_title?: string | null;
  eligible_level_key?: MedalKey | null;
  levels?: Partial<Record<MedalKey, MedalProgress>>;
};

function benefitLines(level: MedalDefinition | null) {
  if (!level) return [];

  const lines: string[] = [];

  if (level.waitlist_priority > 0) {
    lines.push("Prioridad en lista de espera");
  }
  if (level.event_discount_pct > 0) {
    lines.push(`${level.event_discount_pct}% en talleres y eventos elegibles`);
  }
  if (level.private_discount_pct > 0) {
    lines.push(`${level.private_discount_pct}% en clases privadas`);
  }
  if (level.monthly_guest_invites > 0) {
    lines.push(
      `${level.monthly_guest_invites} pase${level.monthly_guest_invites === 1 ? "" : "s"} de invitada al mes`,
    );
  }

  return lines;
}

function requirementLines(level: MedalDefinition, progress: MedalProgress) {
  const lines: Array<{ done: boolean; label: string }> = [];

  const activeDays = progress.active_days ?? 0;
  const continuity = progress.continuity_months ?? 0;
  const noShows = progress.no_show_count ?? 0;
  const renewalGap = progress.renewal_gap_days ?? 0;

  lines.push({
    done: Boolean(progress.active_days_met),
    label: progress.active_days_met
      ? `Días activos · ${activeDays}/${level.required_active_days}`
      : `Te faltan ${Math.max(level.required_active_days - activeDays, 0)} días activos`,
  });
  lines.push({
    done: Boolean(progress.continuity_met),
    label: progress.continuity_met
      ? `Continuidad · ${continuity}/${level.min_continuity_months} meses`
      : `Te faltan ${Math.max(level.min_continuity_months - continuity, 0)} meses de continuidad`,
  });
  lines.push({
    done: Boolean(progress.no_show_met),
    label: progress.no_show_met
      ? `No shows dentro del límite · ${noShows}/${level.max_no_shows}`
      : `No shows · ${noShows}, máximo ${level.max_no_shows}`,
  });
  lines.push({
    done: Boolean(progress.renewal_met),
    label: progress.renewal_met
      ? `Renovación dentro del límite · ${renewalGap}/${level.max_renewal_gap_days} días`
      : `Renovación · ${renewalGap} días, máximo ${level.max_renewal_gap_days}`,
  });

  return lines;
}

export default async function StudentRewardsPage() {
  const ctx = await getStudentRewardsContext();

  if (ctx.onboarding && !ctx.onboarding.access_unlocked_at) {
    const upcomingClass =
      [...ctx.snapshot.upcoming].sort(
        (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
      )[0] ?? null;

    return (
      <RewardsOnboardingActivation
        onboarding={ctx.onboarding}
        upcomingClass={upcomingClass}
        timeZone={ctx.studio.timezone}
        studioId={ctx.membership.studio_id}
        studioName={ctx.studio.name}
      />
    );
  }

  if (
    ctx.onboarding?.access_unlocked_at &&
    !ctx.onboarding.access_acknowledged_at &&
    ctx.onboarding.access_method !== "legacy"
  ) {
    return <MedalsAccessUnlocked />;
  }

  const [{ data: statusData }, { data: levelsData }] = await Promise.all([
    ctx.supabase.rpc("student_reward_status_snapshot"),
    ctx.supabase
      .from("reward_status_level_definitions")
      .select(
        "level_key,level_order,title,required_active_days,max_no_shows,min_continuity_months,max_renewal_gap_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites",
      )
      .eq("studio_id", ctx.membership.studio_id)
      .order("level_order"),
  ]);

  const status = (statusData as MedalStatusSnapshot | null) ?? null;
  const levels = (levelsData ?? []) as MedalDefinition[];
  const currentLevel =
    levels.find((level) => level.level_key === status?.medal_key) ?? null;
  const currentOrder = currentLevel?.level_order ?? 0;
  const targetLevel =
    levels.find((level) => level.level_order > currentOrder) ??
    (currentLevel ? null : levels[0] ?? null);
  const targetProgress = targetLevel ? (status?.levels?.[targetLevel.level_key] ?? {}) : null;
  const benefits = benefitLines(currentLevel);
  const availableRewards = ctx.rewards.filter((reward) => reward.status === "available");

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/perfil"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Perfil
        </Link>
        <p className="student-eyebrow mt-3">Constancia en Demeter</p>
        <h1 className="student-page-title mt-1">Medallas y beneficios</h1>
        <p className="student-body mt-2">
          Tu medalla reconoce tu constancia. Tu nivel técnico se gestiona por separado en
          Evaluaciones.
        </p>
      </header>

      <section className="student-card overflow-hidden border-fuchsia-500/20 p-5">
        <p className="student-eyebrow">Tu medalla</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          {status?.medal_title ? `Medalla ${status.medal_title}` : "Sin medalla este mes"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Las medallas se revisan con tu actividad y constancia en Demeter.
        </p>
        <Link
          href="/student/recompensas/medallero"
          className="student-action-secondary mt-4 w-full sm:w-auto"
        >
          Ver mi medalla
        </Link>
      </section>

      <section className="student-card p-5">
        <p className="student-eyebrow">Tus beneficios</p>
        {benefits.length ? (
          <div className="mt-3 space-y-2">
            {benefits.map((benefit) => (
              <p key={benefit} className="flex gap-2 text-sm leading-6 text-zinc-300">
                <span className="text-emerald-300" aria-hidden="true">
                  ✓
                </span>
                <span>{benefit}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Cuando obtengas una medalla con beneficios activos, aparecerán aquí.
          </p>
        )}
        <Link
          href="/student/recompensas/medallero"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-fuchsia-300"
        >
          Ver todos los beneficios →
        </Link>
      </section>

      {targetLevel && targetProgress ? (
        <section className="student-card p-5">
          <p className="student-eyebrow">Próxima medalla</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Medalla {targetLevel.title}</h2>
          <div className="mt-4 space-y-2">
            {requirementLines(targetLevel, targetProgress).map((item) => (
              <div
                key={item.label}
                className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2.5"
              >
                <span
                  className={item.done ? "text-emerald-300" : "text-zinc-500"}
                  aria-hidden="true"
                >
                  {item.done ? "✓" : "○"}
                </span>
                <span className={item.done ? "text-sm text-zinc-300" : "text-sm text-white"}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            No necesitas obtener las medallas una por una. El Medallero muestra los requisitos de
            cada una.
          </p>
          <Link
            href="/student/recompensas/medallero"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-fuchsia-300"
          >
            Ver requisitos de todas las medallas →
          </Link>
        </section>
      ) : null}

      {availableRewards.length ? (
        <section>
          <div className="mb-2">
            <p className="student-eyebrow">Recompensas</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Disponibles para ti</h2>
          </div>
          <div className="space-y-2">
            {availableRewards.slice(0, 3).map((reward) => (
              <Link
                key={reward.id}
                href={`/student/recompensas/recompensa/${reward.id}`}
                className="student-card student-card-interactive grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-white">
                    {rewardBenefitLabel(reward)}
                  </strong>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {reward.expires_at
                      ? `Disponible hasta ${formatDateTime(reward.expires_at, ctx.studio.timezone)}`
                      : "Disponible para usar"}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xl text-zinc-600">
                  ›
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/student/recompensas/mis-recompensas"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-fuchsia-300"
          >
            Ver todas las recompensas →
          </Link>
        </section>
      ) : null}

      <section>
        <p className="student-eyebrow mb-2">Explorar</p>
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <Link
            href="/student/retos"
            className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]"
          >
            <span>
              <strong className="block text-sm text-white">Retos</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Objetivos temporales y competencias
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-zinc-600">
              ›
            </span>
          </Link>
          <Link
            href="/student/recompensas/logros"
            className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]"
          >
            <span>
              <strong className="block text-sm text-white">Logros</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Lo que ya has conseguido con tu constancia
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-zinc-600">
              ›
            </span>
          </Link>
          <Link
            href="/student/recompensas/mis-recompensas"
            className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]"
          >
            <span>
              <strong className="block text-sm text-white">Recompensas</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Premios ganados, utilizados y vencidos
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-zinc-600">
              ›
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
