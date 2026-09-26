import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";

import MedalInfoDialog from "./MedalInfoDialog";

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
  benefits_definition: Record<string, unknown> | null;
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
  eligible?: boolean;
};

type MedalStatusSnapshot = {
  access_unlocked?: boolean;
  medal_key?: MedalKey | null;
  medal_title?: string | null;
  eligible_level_key?: MedalKey | null;
  levels?: Partial<Record<MedalKey, MedalProgress>>;
};

const visuals: Record<
  MedalKey,
  { accent: string; border: string; glow: string; wash: string; symbol: string }
> = {
  bronze: {
    accent: "#CD7F32",
    border: "rgba(205,127,50,0.55)",
    glow: "rgba(205,127,50,0.18)",
    wash: "rgba(205,127,50,0.10)",
    symbol: "D",
  },
  silver: {
    accent: "#C0C0C0",
    border: "rgba(192,192,192,0.5)",
    glow: "rgba(192,192,192,0.14)",
    wash: "rgba(192,192,192,0.08)",
    symbol: "D",
  },
  gold: {
    accent: "#D4AF37",
    border: "rgba(212,175,55,0.56)",
    glow: "rgba(212,175,55,0.18)",
    wash: "rgba(212,175,55,0.10)",
    symbol: "D",
  },
  diamond: {
    accent: "#5EDFFF",
    border: "rgba(94,223,255,0.58)",
    glow: "rgba(94,223,255,0.18)",
    wash: "rgba(94,223,255,0.10)",
    symbol: "◆",
  },
};

function requirementState(met: boolean | undefined) {
  return met ? "text-emerald-300" : "text-zinc-300";
}

function benefitLines(level: MedalDefinition, studioName: string) {
  const lines: string[] = [];

  lines.push(
    level.waitlist_priority === 1
      ? "Prioridad básica en lista de espera"
      : level.waitlist_priority === 2
        ? "Mayor prioridad en lista de espera"
        : level.waitlist_priority === 3
          ? "Prioridad alta en lista de espera"
          : "Prioridad máxima en lista de espera",
  );

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
  if (level.level_key !== "bronze") {
    lines.push("Acceso anticipado a inscripciones y promociones especiales");
  }
  if (level.level_key === "diamond") {
    lines.push(`Beneficios y experiencias premium de ${studioName}`);
  }

  return lines;
}

export default async function StudentMedalsPage() {
  const { supabase, membership, studio } = await getStudentPortalContext();

  const [{ data: statusData }, { data: levelsData }] = await Promise.all([
    supabase.rpc("student_reward_status_snapshot"),
    supabase
      .from("reward_status_level_definitions")
      .select(
        "level_key,level_order,title,required_active_days,max_no_shows,min_continuity_months,max_renewal_gap_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites,benefits_definition",
      )
      .eq("studio_id", membership.studio_id)
      .order("level_order"),
  ]);

  const status = (statusData as MedalStatusSnapshot | null) ?? null;
  const levels = (levelsData ?? []) as MedalDefinition[];

  if (!status?.access_unlocked) {
    return (
      <main className="space-y-5 pb-5">
        <header>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            Medallas
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Medallero</h1>
        </header>

        <section className="rounded-[28px] border border-fuchsia-500/25 bg-[radial-gradient(circle_at_80%_0%,rgba(236,72,153,0.16),transparent_36%),rgba(255,255,255,0.025)] p-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 text-2xl text-fuchsia-300">
            ◇
          </div>
          <h2 className="mt-4 text-xl font-semibold text-white">Activa tus Medallas</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-400">
            Completa tu onboarding para entrar al programa mensual de Medallas.
          </p>
          <Link
            href="/student/recompensas"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl bg-fuchsia-600 px-5 text-sm font-semibold text-white"
          >
            Continuar activación
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-5 pb-5">
      <header>
        <Link href="/student/recompensas" className="text-xs font-semibold text-fuchsia-300">
          ← Mi progreso
        </Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Medallas
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Medallero</h1>
        <p className="mt-1.5 max-w-xl text-sm leading-5 text-zinc-400">
          Tu Medalla se evalúa cada mes. No necesitas avanzar una por una: puedes obtener
          directamente cualquier Medalla cuyos requisitos cumplas.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Tu Medalla actual
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <strong className="text-lg text-white">
            {status.medal_title ? `Medalla ${status.medal_title}` : "Sin Medalla este ciclo"}
          </strong>
          {status.eligible_level_key ? (
            <span className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-300">
              Proyección ·{" "}
              {levels.find((level) => level.level_key === status.eligible_level_key)?.title}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          La proyección usa tu avance del ciclo actual; la Medalla se asigna al cerrar el mes.
        </p>
      </section>

      <div className="space-y-3">
        {levels.map((level) => {
          const progress = status.levels?.[level.level_key] ?? {};
          const visual = visuals[level.level_key];
          const current = status.medal_key === level.level_key;

          return (
            <section
              key={level.level_key}
              className="overflow-hidden rounded-[26px] border p-4 sm:p-5"
              style={{
                borderColor: visual.border,
                backgroundImage: `radial-gradient(circle at 88% 0%, ${visual.wash}, transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))`,
                boxShadow: current ? `0 0 30px ${visual.glow}` : "none",
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-bold"
                  style={{
                    color: visual.accent,
                    borderColor: visual.border,
                    background: visual.wash,
                    boxShadow: `0 0 18px ${visual.glow}`,
                  }}
                >
                  {visual.symbol}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">Medalla {level.title}</h2>
                    {current ? (
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                        Actual
                      </span>
                    ) : progress.eligible ? (
                      <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-500/[0.08] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-fuchsia-300">
                        Cumples hoy
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">Requisitos del ciclo mensual</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Días activos <MedalInfoDialog kind="activeDays" />
                  </div>
                  <p
                    className={`mt-1 text-sm font-semibold ${requirementState(progress.active_days_met)}`}
                  >
                    {progress.active_days ?? 0} / {level.required_active_days}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    No show <MedalInfoDialog kind="noShow" />
                  </div>
                  <p
                    className={`mt-1 text-sm font-semibold ${requirementState(progress.no_show_met)}`}
                  >
                    {progress.no_show_count ?? 0} / máx. {level.max_no_shows}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Continuidad <MedalInfoDialog kind="continuity" />
                  </div>
                  <p
                    className={`mt-1 text-sm font-semibold ${requirementState(progress.continuity_met)}`}
                  >
                    {progress.continuity_months ?? 0} / {level.min_continuity_months} meses
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Renovación <MedalInfoDialog kind="renewal" />
                  </div>
                  <p
                    className={`mt-1 text-sm font-semibold ${requirementState(progress.renewal_met)}`}
                  >
                    {progress.renewal_gap_days ?? 0} / máx. {level.max_renewal_gap_days} días
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Recompensas
                </p>
                <div className="mt-2 space-y-1.5">
                  {benefitLines(level, studio.name).map((line) => (
                    <p key={line} className="text-xs text-zinc-300">
                      <span className="mr-2 text-fuchsia-300">✓</span>
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
