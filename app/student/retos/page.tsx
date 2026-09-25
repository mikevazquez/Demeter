import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";
import { rewardDefinitionLabel } from "@/lib/student/rewards";

type ChallengeCard = {
  rule_id: string;
  status: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  competition_mode: "individual" | "leaderboard";
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  finished_at: string | null;
  archived: boolean;
  archived_at: string | null;
  reward_visibility: "visible" | "surprise";
  reward_definition: unknown;
  condition_definition: unknown;
  participation_status: string | null;
  is_enrolled: boolean;
  participant_count: number | null;
  current_value: number;
  cycle_status: string | null;
  completed_at: string | null;
};

function cards(value: unknown): ChallengeCard[] {
  return Array.isArray(value) ? (value as ChallengeCard[]) : [];
}

function rewardLabel(challenge: ChallengeCard) {
  if (challenge.reward_visibility === "surprise") return "Recompensa sorpresa";
  return rewardDefinitionLabel(challenge.reward_definition);
}

function conditionTarget(value: unknown) {
  const definition = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
  const first =
    conditions[0] && typeof conditions[0] === "object"
      ? (conditions[0] as Record<string, unknown>)
      : {};
  const target = Number(first.target ?? 0);
  return Number.isFinite(target) ? target : 0;
}

function dateLabel(value: string | null, timezone: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export default async function StudentChallengesPage() {
  const portal = await getStudentPortalContext();
  const { data, error } = await portal.supabase.rpc("student_list_reward_challenges", {
    p_studio_id: portal.membership.studio_id,
  });

  if (error) throw new Error("student_challenges_load_failed");

  const all = cards(data);
  const active = all.filter((challenge) => challenge.status === "active");
  const upcoming = all.filter((challenge) => challenge.status === "scheduled");
  const finished = all.filter(
    (challenge) => challenge.status === "finished" && !challenge.archived,
  );
  const history = all.filter((challenge) => challenge.status === "finished" && challenge.archived);

  return (
    <main className="space-y-6 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Medallas y beneficios
        </Link>
        <p className="student-eyebrow mt-3">Retos</p>
        <h1 className="student-page-title mt-1">Retos</h1>
        <p className="student-body mt-2">
          Objetivos temporales y competencias. Aquí sólo cuenta lo que realmente hayas completado.
        </p>
      </header>

      {active.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
              Activos
            </h2>
            <span className="text-xs text-zinc-500">{active.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((challenge, index) => {
              const target = conditionTarget(challenge.condition_definition);
              const remaining = Math.max(target - challenge.current_value, 0);

              return (
              <Link
                key={challenge.rule_id}
                href={`/student/retos/${challenge.rule_id}`}
                className={`group overflow-hidden rounded-3xl border bg-white/[0.035] transition hover:border-fuchsia-400/40 ${
                  index === 0
                    ? "border-fuchsia-500/35 shadow-[0_0_35px_rgba(255,10,138,0.08)] md:col-span-2"
                    : "border-white/10"
                }`}
              >
                {challenge.cover_url ? (
                  <div
                    className="h-40 bg-cover bg-center md:h-48"
                    style={{
                      backgroundImage: `linear-gradient(to top, rgba(7,8,12,.85), rgba(7,8,12,.08)), url("${challenge.cover_url}")`,
                    }}
                  />
                ) : (
                  <div className="h-24 bg-[radial-gradient(circle_at_80%_20%,rgba(255,10,138,.28),transparent_35%),linear-gradient(135deg,#12131a,#090a0f)]" />
                )}
                <div className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-fuchsia-300">
                      {challenge.competition_mode === "leaderboard" ? "Competencia" : "Individual"}
                    </span>
                    {challenge.competition_mode === "leaderboard" ? (
                      <span className="text-xs text-zinc-500">
                        {challenge.participant_count ?? 0} inscritas
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">{challenge.title}</h3>
                    {challenge.description ? (
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-400">
                        {challenge.description}
                      </p>
                    ) : null}
                  </div>
                  {target > 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-3.5 py-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <strong className="text-white">
                          {challenge.current_value} de {target}
                        </strong>
                        <span className="text-zinc-500">
                          {remaining > 0 ? `Te faltan ${remaining}` : "Meta completada"}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-zinc-500">
                      Termina {dateLabel(challenge.scheduled_end_at, portal.studio.timezone)}
                    </span>
                    <span className="rounded-xl bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-200">
                      {rewardLabel(challenge)}
                    </span>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {upcoming.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
            Próximamente
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((challenge) => (
              <Link
                key={challenge.rule_id}
                href={`/student/retos/${challenge.rule_id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-fuchsia-400/30"
              >
                <p className="text-sm font-semibold text-white">{challenge.title}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Inicia {dateLabel(challenge.scheduled_start_at, portal.studio.timezone)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {finished.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
              Finalizados
            </h2>
            <span className="text-xs text-zinc-500">{finished.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {finished.map((challenge) => (
              <Link
                key={challenge.rule_id}
                href={`/student/retos/${challenge.rule_id}`}
                className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.035] p-5 transition hover:border-emerald-300/35"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
                    Finalizado
                  </span>
                  <span className="text-xs text-zinc-500">
                    {challenge.competition_mode === "leaderboard" ? "Competencia" : "Individual"}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{challenge.title}</h3>
                {challenge.description ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-400">
                    {challenge.description}
                  </p>
                ) : null}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-500">
                    Finalizó{" "}
                    {dateLabel(
                      challenge.finished_at ?? challenge.scheduled_end_at,
                      portal.studio.timezone,
                    )}
                  </span>
                  <span className="text-xs font-semibold text-emerald-300">Ver resultado →</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {history.length ? (
        <details className="group rounded-3xl border border-white/10 bg-white/[0.02]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
                Historial
              </p>
              <p className="mt-1 text-xs text-zinc-500">Retos archivados · {history.length}</p>
            </div>
            <span className="text-xl text-zinc-500 transition group-open:rotate-90">›</span>
          </summary>
          <div className="grid gap-2 border-t border-white/10 p-3">
            {history.map((challenge) => (
              <Link
                key={challenge.rule_id}
                href={`/student/retos/${challenge.rule_id}`}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{challenge.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {challenge.competition_mode === "leaderboard"
                      ? "Competencia finalizada"
                      : "Reto finalizado"}
                  </p>
                </div>
                <span className="text-zinc-600">›</span>
              </Link>
            ))}
          </div>
        </details>
      ) : null}

      {!all.length ? (
        <section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-fuchsia-500/10 text-2xl text-fuchsia-300">
            ♜
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">No hay retos disponibles</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Cuando el estudio publique uno nuevo aparecerá aquí.
          </p>
        </section>
      ) : null}
    </main>
  );
}
