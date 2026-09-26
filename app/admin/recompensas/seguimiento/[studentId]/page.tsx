import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../RewardsNav";
import {
  EmptyState,
  StatusBadge,
  asArray,
  asObject,
  formatDateTime,
  metricLabels,
  rewardDefinitionLabel,
} from "../../ui";

function conditionProgressLabel(value: unknown) {
  const rows = asArray(value).map(asObject);
  if (!rows.length) return "Aún sin actividad contabilizada.";

  const pending = rows.filter((row) => !Boolean(row.passed));
  if (!pending.length) return "Objetivo completado.";

  return pending
    .map((row) => {
      const metric = String(row.metric ?? "");
      const current = Number(row.current ?? 0);
      const target = Number(row.target ?? 0);
      const comparator = String(row.comparator ?? "gte");
      const label = metricLabels[metric] ?? metric;
      if (comparator === "gte") {
        return `${label}: faltan ${Math.max(target - current, 0)} · ${current}/${target}`;
      }
      if (comparator === "lte") {
        return `${label}: actual ${current} · máximo ${target}`;
      }
      return `${label}: actual ${current} · meta ${target}`;
    })
    .join(" · ");
}

export default async function StudentRewardsProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const tab = ["summary", "achievements", "rewards", "history"].includes(String(query.tab))
    ? String(query.tab)
    : "summary";

  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const { data: student } = await ctx.supabase
    .from("students")
    .select("id,full_name,lifecycle_status,active,created_at")
    .eq("id", studentId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!student) notFound();

  const [
    programParticipationsResult,
    ruleParticipationsResult,
    evaluationsResult,
    achievementsResult,
    rewardsResult,
    programEventsResult,
  ] = await Promise.all([
    ctx.supabase
      .from("reward_program_participations")
      .select(
        "id,program_id,program_version_number,status,current_level_order,joined_at,completed_at,closed_at,updated_at",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("updated_at", { ascending: false }),
    ctx.supabase
      .from("reward_participations")
      .select("id,rule_id,joined_version_number,status,joined_at,fulfilled_at,closed_at,updated_at")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("updated_at", { ascending: false }),
    ctx.supabase
      .from("reward_progress_evaluations")
      .select("id,rule_id,version_number,condition_results,progress,fulfilled,evaluated_at")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("evaluated_at", { ascending: false })
      .limit(300),
    ctx.supabase
      .from("reward_achievement_unlocks")
      .select(
        "id,rule_id,version_number,achievement_key,level_key,title_snapshot,badge_snapshot,unlocked_at",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("unlocked_at", { ascending: false }),
    ctx.supabase
      .from("reward_instances")
      .select(
        "id,rule_id,version_number,status,kind,benefit_definition,origin_snapshot,created_at,expires_at,redeemed_at,revoked_at,revoked_reason",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("reward_program_events")
      .select("id,program_id,program_version_number,level_id,event_type,details,occurred_at")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", student.id)
      .order("occurred_at", { ascending: false })
      .limit(150),
  ]);

  const programParticipations = programParticipationsResult.data ?? [];
  const ruleParticipations = ruleParticipationsResult.data ?? [];
  const evaluations = evaluationsResult.data ?? [];
  const achievements = achievementsResult.data ?? [];
  const rewards = rewardsResult.data ?? [];
  const programEvents = programEventsResult.data ?? [];

  const programIds = [...new Set(programParticipations.map((item) => item.program_id))];
  const programVersionsResult = programIds.length
    ? await ctx.supabase
        .from("reward_program_versions")
        .select("program_id,version_number,name,progression_mode")
        .in("program_id", programIds)
    : { data: [] };
  const programVersionMap = new Map(
    (programVersionsResult.data ?? []).map((item) => [
      `${item.program_id}:${item.version_number}`,
      item,
    ]),
  );

  const programLevelsResult = programIds.length
    ? await ctx.supabase
        .from("reward_program_levels")
        .select(
          "id,program_id,program_version_number,level_order,title,rule_id,rule_version_number",
        )
        .in("program_id", programIds)
    : { data: [] };
  const programLevels = programLevelsResult.data ?? [];

  const ruleIds = [
    ...new Set([
      ...ruleParticipations.map((item) => item.rule_id),
      ...achievements.map((item) => item.rule_id),
      ...rewards.flatMap((item) => (item.rule_id ? [item.rule_id] : [])),
      ...programLevels.map((item) => item.rule_id),
    ]),
  ];
  const rulesResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rules")
        .select("id,status,current_version_number")
        .in("id", ruleIds)
    : { data: [] };
  const ruleMap = new Map((rulesResult.data ?? []).map((item) => [item.id, item]));

  const ruleVersionsResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select(
          "rule_id,version_number,name,family,presentation_definition,condition_definition,reward_definition",
        )
        .in("rule_id", ruleIds)
    : { data: [] };
  const ruleVersionMap = new Map(
    (ruleVersionsResult.data ?? []).map((item) => [`${item.rule_id}:${item.version_number}`, item]),
  );

  const latestEvaluationByRule = new Map<string, (typeof evaluations)[number]>();
  for (const evaluation of evaluations) {
    if (!latestEvaluationByRule.has(evaluation.rule_id)) {
      latestEvaluationByRule.set(evaluation.rule_id, evaluation);
    }
  }

  const currentStreakCandidates = evaluations
    .map((evaluation) => asObject(evaluation.progress))
    .flatMap((progress) => [
      Number(progress["attendance.streak.weeks.current"] ?? 0),
      Number(progress["loyalty.current_consecutive_periods"] ?? 0),
    ])
    .filter(Number.isFinite);
  const bestStreakCandidates = evaluations
    .map((evaluation) => asObject(evaluation.progress))
    .flatMap((progress) => [
      Number(progress["attendance.streak.weeks.best"] ?? 0),
      Number(progress["loyalty.best_consecutive_periods"] ?? 0),
    ])
    .filter(Number.isFinite);
  const currentStreak = currentStreakCandidates.length ? Math.max(...currentStreakCandidates) : 0;
  const bestStreak = bestStreakCandidates.length ? Math.max(...bestStreakCandidates) : 0;

  const challengeRows = ruleParticipations
    .map((participation) => {
      const rule = ruleMap.get(participation.rule_id);
      const version = rule
        ? ruleVersionMap.get(`${participation.rule_id}:${rule.current_version_number}`)
        : undefined;
      const evaluation = latestEvaluationByRule.get(participation.rule_id);
      return { participation, rule, version, evaluation };
    })
    .filter((item) => item.version?.family === "challenge");

  const timeline = [
    ...programEvents.map((event) => ({
      id: `program-${event.id}`,
      at: event.occurred_at,
      type: "program",
      title:
        event.event_type === "program_completed"
          ? "Programa completado"
          : event.event_type === "level_completed"
            ? "Nivel completado"
            : event.event_type === "joined"
              ? "Entró a un programa"
              : "Progreso de programa",
      detail: String(asObject(event.details).title ?? ""),
    })),
    ...achievements.map((achievement) => ({
      id: `achievement-${achievement.id}`,
      at: achievement.unlocked_at,
      type: "achievement",
      title: "Logro desbloqueado",
      detail: achievement.title_snapshot,
    })),
    ...rewards.map((reward) => ({
      id: `reward-${reward.id}`,
      at: reward.redeemed_at ?? reward.revoked_at ?? reward.created_at,
      type: "reward",
      title:
        reward.status === "redeemed"
          ? "Recompensa utilizada"
          : reward.status === "revoked"
            ? "Recompensa ajustada"
            : "Recompensa obtenida",
      detail: rewardDefinitionLabel(reward.benefit_definition, ctx.studio.locale, ctx.studio.currency),
      rewardId: reward.id,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/recompensas/seguimiento"
            className="text-sm font-semibold text-zinc-400 hover:text-white"
          >
            ← Seguimiento
          </Link>
          <p className="mt-4 eyebrow">PROGRESO INDIVIDUAL · {ctx.studio.name}</p>
          <h1 className="dashboard-title">{student.full_name}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Trayectoria calculada por comportamiento real. No existe edición manual de progreso.
          </p>
        </div>
        <StatusBadge
          status={student.lifecycle_status === "active" ? "active" : "closed"}
          label={student.lifecycle_status === "active" ? "Activa" : "Inactiva"}
        />
      </header>

      {student.lifecycle_status !== "active" ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
          La alumna está inactiva. Su trayectoria, logros y recompensas históricas se conservan.
        </div>
      ) : null}

      <nav className="flex gap-2 overflow-x-auto">
        {[
          ["summary", "Resumen"],
          ["achievements", "Logros"],
          ["rewards", "Recompensas"],
          ["history", "Historial"],
        ].map(([value, label]) => (
          <Link
            key={value}
            href={`/admin/recompensas/seguimiento/${student.id}?tab=${value}`}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              tab === value ? "bg-[#FF0A8A] text-white" : "border border-white/10 text-zinc-400"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "summary" ? (
        <div className="grid gap-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Programas</p>
              <strong className="mt-2 block text-2xl text-white">
                {programParticipations.length}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Logros</p>
              <strong className="mt-2 block text-2xl text-white">{achievements.length}</strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Racha actual</p>
              <strong className="mt-2 block text-2xl text-white">{currentStreak}</strong>
              <span className="text-xs text-zinc-500">Mejor registrada: {bestStreak}</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Recompensas</p>
              <strong className="mt-2 block text-2xl text-white">{rewards.length}</strong>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              PROGRAMAS
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Progreso actual</h2>
            <div className="mt-5 grid gap-3">
              {!programParticipations.length ? (
                <EmptyState title="Sin programas en su trayectoria" />
              ) : (
                programParticipations.map((participation) => {
                  const program = programVersionMap.get(
                    `${participation.program_id}:${participation.program_version_number}`,
                  );
                  const level = programLevels.find(
                    (item) =>
                      item.program_id === participation.program_id &&
                      item.program_version_number === participation.program_version_number &&
                      item.level_order === participation.current_level_order,
                  );
                  const evaluation = level ? latestEvaluationByRule.get(level.rule_id) : undefined;
                  return (
                    <article
                      key={participation.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong className="text-white">{program?.name ?? "Programa"}</strong>
                          <p className="mt-1 text-sm text-zinc-400">
                            {participation.status === "completed"
                              ? "Programa completado"
                              : level
                                ? `Nivel actual: ${level.title}`
                                : "En progreso"}
                          </p>
                          {evaluation && participation.status !== "completed" ? (
                            <p className="mt-2 text-xs text-zinc-500">
                              {conditionProgressLabel(evaluation.condition_results)}
                            </p>
                          ) : null}
                        </div>
                        <StatusBadge status={participation.status} />
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              RETOS
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Retos en la trayectoria</h2>
            <div className="mt-5 grid gap-3">
              {!challengeRows.length ? (
                <EmptyState title="Sin retos registrados" />
              ) : (
                challengeRows.map(({ participation, version, evaluation }) => (
                  <article
                    key={participation.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong className="text-white">{version?.name ?? "Reto"}</strong>
                        <p className="mt-2 text-xs text-zinc-500">
                          {evaluation
                            ? conditionProgressLabel(evaluation.condition_results)
                            : "Aún sin actividad contabilizada."}
                        </p>
                      </div>
                      <StatusBadge status={participation.status} />
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "achievements" ? (
        <section className="grid gap-3">
          {!achievements.length ? (
            <EmptyState title="Todavía no ha desbloqueado logros" />
          ) : (
            achievements.map((achievement) => (
              <article
                key={achievement.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
                  LOGRO
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  {achievement.title_snapshot}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Desbloqueado {formatDateTime(achievement.unlocked_at, ctx.studio.locale, ctx.studio.timezone)}
                </p>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "rewards" ? (
        <section className="grid gap-3">
          {!rewards.length ? (
            <EmptyState title="Todavía no ha obtenido recompensas" />
          ) : (
            rewards.map((reward) => (
              <Link
                key={reward.id}
                href={`/admin/recompensas/generadas/${reward.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#FF0A8A]/35"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="text-white">
                      {rewardDefinitionLabel(reward.benefit_definition, ctx.studio.locale, ctx.studio.currency)}
                    </strong>
                    <p className="mt-1 text-xs text-zinc-500">
                      Obtenida {formatDateTime(reward.created_at, ctx.studio.locale, ctx.studio.timezone)}
                    </p>
                  </div>
                  <StatusBadge status={reward.status} />
                </div>
              </Link>
            ))
          )}
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="grid gap-2">
          {!timeline.length ? (
            <EmptyState title="Todavía no hay hitos en su trayectoria" />
          ) : (
            timeline.map((item) =>
              "rewardId" in item && item.rewardId ? (
                <Link
                  key={item.id}
                  href={`/admin/recompensas/generadas/${item.rewardId}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-[#FF0A8A]/30"
                >
                  <strong className="text-sm text-white">{item.title}</strong>
                  <p className="mt-1 text-sm text-zinc-400">{item.detail}</p>
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(item.at, ctx.studio.locale, ctx.studio.timezone)}</p>
                </Link>
              ) : (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <strong className="text-sm text-white">{item.title}</strong>
                  {item.detail ? <p className="mt-1 text-sm text-zinc-400">{item.detail}</p> : null}
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(item.at, ctx.studio.locale, ctx.studio.timezone)}</p>
                </div>
              ),
            )
          )}
        </section>
      ) : null}
    </RewardsShell>
  );
}
