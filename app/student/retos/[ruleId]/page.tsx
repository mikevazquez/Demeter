import Link from "next/link";
import { notFound } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";
import { metricLabel, rewardDefinitionLabel, rewardObject } from "@/lib/student/rewards";

import { enrollChallengeAction } from "../actions";

type Challenge = {
  rule_id: string;
  status: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  competition_mode: "individual" | "leaderboard";
  tie_breaker: "first_to_reach" | "shared";
  ranking_metric: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  reward_visibility: "visible" | "surprise";
  reward_definition: unknown;
  condition_definition: unknown;
  participation_id: string | null;
  participation_status: string | null;
  is_enrolled: boolean;
  participant_count: number | null;
  current_value: number;
  cycle_status: string | null;
  completed_at: string | null;
};

type LeaderboardRow = {
  position: number;
  name: string;
  value: number;
  is_you: boolean;
};

type Leaderboard = {
  metric: string;
  tie_breaker: string;
  top3: LeaderboardRow[];
  you: {
    position: number;
    name: string;
    value: number;
    gap_to_top3: number;
  };
};

function list(value: unknown): Challenge[] {
  return Array.isArray(value) ? (value as Challenge[]) : [];
}

function conditionTarget(value: unknown) {
  const definition = rewardObject(value);
  const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
  const first = rewardObject(conditions[0]);
  const target = Number(first.target ?? 0);
  return Number.isFinite(target) ? target : 0;
}

function rewardLabel(challenge: Challenge) {
  if (challenge.reward_visibility === "surprise") return "Recompensa sorpresa";
  return rewardDefinitionLabel(challenge.reward_definition);
}

function dateTimeLabel(value: string | null, timezone: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function positionMedal(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `#${position}`;
}

export default async function ChallengeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { ruleId } = await params;
  const query = await searchParams;
  const portal = await getStudentPortalContext();

  const { data, error } = await portal.supabase.rpc("student_list_reward_challenges", {
    p_studio_id: portal.membership.studio_id,
  });
  if (error) throw new Error("student_challenges_load_failed");

  const challenge = list(data).find((item) => item.rule_id === ruleId);
  if (!challenge) notFound();

  let leaderboard: Leaderboard | null = null;
  if (challenge.competition_mode === "leaderboard" && challenge.is_enrolled) {
    const { data: ranking, error: rankingError } = await portal.supabase.rpc(
      "student_reward_challenge_leaderboard",
      { p_rule_id: challenge.rule_id },
    );
    if (!rankingError && ranking && typeof ranking === "object") {
      leaderboard = ranking as Leaderboard;
    }
  }

  const target = conditionTarget(challenge.condition_definition);
  const percent = target > 0 ? Math.min(100, Math.round((challenge.current_value / target) * 100)) : 0;
  const completed =
    challenge.participation_status === "fulfilled" ||
    challenge.cycle_status === "fulfilled" ||
    challenge.completed_at !== null;

  return (
    <main className="space-y-5 pb-6">
      <header>
        <Link href="/student/retos" className="text-sm font-semibold text-zinc-400 hover:text-white">
          ← Retos
        </Link>
      </header>

      {query.joined ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          Ya estás inscrita. Desde ahora tus resultados reales cuentan para el ranking.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          No se pudo completar la acción. {query.error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/25 bg-[#0d0e14] shadow-[0_0_45px_rgba(255,10,138,0.08)]">
        {challenge.cover_url ? (
          <div
            className="h-52 bg-cover bg-center"
            style={{ backgroundImage: `linear-gradient(to top, rgba(6,7,10,.9), rgba(6,7,10,.05)), url("${challenge.cover_url}")` }}
          />
        ) : (
          <div className="h-28 bg-[radial-gradient(circle_at_75%_10%,rgba(255,10,138,.32),transparent_34%),linear-gradient(135deg,#17111d,#08090e)]" />
        )}
        <div className="space-y-4 p-5 sm:p-6">
          <span className="inline-flex rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">
            {challenge.competition_mode === "leaderboard" ? "Competencia" : "Individual"}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{challenge.title}</h1>
            {challenge.description ? (
              <p className="mt-2 text-sm leading-6 text-zinc-400">{challenge.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>Inicio: {dateTimeLabel(challenge.scheduled_start_at, portal.studio.timezone)}</span>
            <span>•</span>
            <span>Cierre: {dateTimeLabel(challenge.scheduled_end_at, portal.studio.timezone)}</span>
          </div>
        </div>
      </section>

      {challenge.competition_mode === "leaderboard" && !challenge.is_enrolled ? (
        <section className="rounded-3xl border border-fuchsia-500/25 bg-fuchsia-500/[0.055] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-300">
            Inscripción requerida
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Entra a la competencia</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Solo las alumnas inscritas aparecen en el ranking. Al entrar podrás ver el Top 3,
            tu posición y cuánto te falta para alcanzar el podio.
          </p>
          <form action={enrollChallengeAction} className="mt-5">
            <input type="hidden" name="rule_id" value={challenge.rule_id} />
            <button className="w-full rounded-2xl bg-[#FF0A8A] px-4 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(255,10,138,.18)]">
              Inscribirme al reto
            </button>
          </form>
        </section>
      ) : null}

      {challenge.competition_mode === "leaderboard" && leaderboard ? (
        <>
          {leaderboard.you.position <= 3 ? (
            <section className="rounded-3xl border border-fuchsia-500/30 bg-[radial-gradient(circle_at_top_right,rgba(255,10,138,.16),transparent_38%),rgba(255,255,255,.03)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-300">
                Estás en el podio
              </p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-black text-white">
                    {positionMedal(leaderboard.you.position)}
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    {leaderboard.you.value} {metricLabel(leaderboard.metric).toLocaleLowerCase("es-MX")}
                  </p>
                </div>
                <span className="rounded-2xl bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-200">
                  Sigue sumando
                </span>
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-300">
                  Ranking
                </p>
                <h2 className="mt-1 text-xl font-semibold text-white">Top 3</h2>
              </div>
              <span className="text-xs text-zinc-500">
                {challenge.participant_count ?? 0} inscritas
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {leaderboard.top3.map((row) => (
                <div
                  key={`${row.position}-${row.name}`}
                  className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border px-4 py-3 ${
                    row.is_you
                      ? "border-fuchsia-400/40 bg-fuchsia-500/10"
                      : "border-white/10 bg-black/20"
                  }`}
                >
                  <span className="text-xl">{positionMedal(row.position)}</span>
                  <span className="text-sm font-semibold text-white">{row.is_you ? "Tú" : row.name}</span>
                  <span className="text-sm font-bold text-zinc-200">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Tu posición</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <strong className="text-3xl text-white">#{leaderboard.you.position}</strong>
                  <span className="text-sm font-semibold text-zinc-300">{leaderboard.you.value}</span>
                </div>
                {leaderboard.you.position > 3 ? (
                  <span className="max-w-44 text-right text-xs leading-5 text-zinc-400">
                    {leaderboard.you.gap_to_top3 > 0
                      ? `Te faltan ${leaderboard.you.gap_to_top3} para alcanzar el Top 3.`
                      : "Estás empatada con el podio."}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-fuchsia-300">Top 3</span>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {challenge.competition_mode === "individual" ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-300">
            Tu progreso
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <strong className="text-3xl text-white">
              {challenge.current_value} / {target}
            </strong>
            <span className="text-sm font-semibold text-zinc-400">{percent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#FF0A8A]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            {completed
              ? "¡Reto completado!"
              : target > challenge.current_value
                ? `Te faltan ${target - challenge.current_value} para completar la meta.`
                : "Sigue avanzando."}
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-fuchsia-300">
          Recompensa
        </p>
        <p className="mt-2 text-lg font-semibold text-white">{rewardLabel(challenge)}</p>
        {challenge.reward_visibility === "surprise" ? (
          <p className="mt-1 text-sm text-zinc-500">Se revelará cuando corresponda.</p>
        ) : null}
      </section>

      {completed ? (
        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.07] p-5 text-center">
          <div className="text-4xl">🏆</div>
          <h2 className="mt-3 text-xl font-semibold text-white">¡Reto completado!</h2>
          <p className="mt-1 text-sm text-zinc-400">
            La recompensa generada aparece en tu sección de Rewards.
          </p>
          <Link
            href="/student/recompensas/mis-recompensas"
            className="mt-4 inline-flex rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-2.5 text-sm font-semibold text-emerald-200"
          >
            Ver mis recompensas
          </Link>
        </section>
      ) : null}
    </main>
  );
}
