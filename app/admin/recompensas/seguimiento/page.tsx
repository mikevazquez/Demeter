import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import {
  EmptyState,
  StatusBadge,
  asArray,
  asObject,
  metricLabels,
} from "../ui";

function progressSummary(value: unknown) {
  const rows = asArray(value).map(asObject);
  if (!rows.length) return { score: 0, label: "Aún sin actividad contabilizada." };

  let score = 1;
  const pending: string[] = [];

  for (const row of rows) {
    const current = Number(row.current ?? 0);
    const target = Number(row.target ?? 0);
    const passed = Boolean(row.passed);
    const comparator = String(row.comparator ?? "gte");
    const metric = String(row.metric ?? "");
    const name = metricLabels[metric] ?? metric;

    let conditionScore = passed ? 1 : 0;
    if (!passed && comparator === "gte") {
      conditionScore = target > 0 ? Math.max(0, Math.min(current / target, 1)) : 0;
      pending.push(`${name}: faltan ${Math.max(target - current, 0)} · ${current}/${target}`);
    } else if (!passed && comparator === "lte") {
      conditionScore = current > 0 ? Math.max(0, Math.min(target / current, 1)) : 0;
      pending.push(`${name}: actual ${current} · máximo ${target}`);
    } else if (!passed) {
      conditionScore =
        target === 0
          ? 0
          : Math.max(0, 1 - Math.abs(target - current) / Math.max(Math.abs(target), 1));
      pending.push(`${name}: actual ${current} · meta ${target}`);
    }

    score = Math.min(score, conditionScore);
  }

  return {
    score,
    label: pending.length ? pending.join(" · ") : "Objetivo completado.",
  };
}

export default async function RewardsTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const search = String(query.q ?? "").trim();
  const type = ["programs", "challenges", "achievements"].includes(String(query.type))
    ? String(query.type)
    : "programs";

  let studentsQuery = ctx.supabase
    .from("students")
    .select("id,full_name,lifecycle_status")
    .eq("studio_id", ctx.studio.id)
    .order("full_name")
    .limit(100);
  if (search) studentsQuery = studentsQuery.ilike("full_name", `%${search}%`);
  const { data: students } = await studentsQuery;
  const studentIds = (students ?? []).map((student) => student.id);
  const studentMap = new Map((students ?? []).map((student) => [student.id, student]));

  const [programResult, ruleResult, evaluationsResult] = studentIds.length
    ? await Promise.all([
        ctx.supabase
          .from("reward_program_participations")
          .select("id,program_id,student_id,status,current_level_order,program_version_number,updated_at")
          .eq("studio_id", ctx.studio.id)
          .in("student_id", studentIds)
          .order("updated_at", { ascending: false }),
        ctx.supabase
          .from("reward_participations")
          .select("id,rule_id,student_id,status,joined_version_number,updated_at")
          .eq("studio_id", ctx.studio.id)
          .in("student_id", studentIds)
          .order("updated_at", { ascending: false }),
        ctx.supabase
          .from("reward_progress_evaluations")
          .select("id,rule_id,student_id,condition_results,fulfilled,evaluated_at")
          .eq("studio_id", ctx.studio.id)
          .in("student_id", studentIds)
          .order("evaluated_at", { ascending: false })
          .limit(1000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const latestEval = new Map<string, (typeof evaluationsResult.data extends Array<infer U> ? U : never)>();
  for (const evaluation of evaluationsResult.data ?? []) {
    const key = `${evaluation.student_id}:${evaluation.rule_id}`;
    if (!latestEval.has(key)) latestEval.set(key, evaluation as never);
  }

  const programIds = [...new Set((programResult.data ?? []).map((row) => row.program_id))];
  const [programVersionsResult, programLevelsResult] = programIds.length
    ? await Promise.all([
        ctx.supabase
          .from("reward_program_versions")
          .select("program_id,version_number,name")
          .in("program_id", programIds),
        ctx.supabase
          .from("reward_program_levels")
          .select("program_id,program_version_number,level_order,title,rule_id")
          .in("program_id", programIds),
      ])
    : [{ data: [] }, { data: [] }];

  const programMap = new Map(
    (programVersionsResult.data ?? []).map((row) => [
      `${row.program_id}:${row.version_number}`,
      row.name,
    ]),
  );

  const ruleIds = [...new Set((ruleResult.data ?? []).map((row) => row.rule_id))];
  const [rulesResult, ruleVersionsResult] = ruleIds.length
    ? await Promise.all([
        ctx.supabase.from("reward_rules").select("id,current_version_number").in("id", ruleIds),
        ctx.supabase
          .from("reward_rule_versions")
          .select("rule_id,version_number,name,family")
          .in("rule_id", ruleIds),
      ])
    : [{ data: [] }, { data: [] }];

  const ruleStateMap = new Map((rulesResult.data ?? []).map((row) => [row.id, row]));
  const ruleVersionMap = new Map(
    (ruleVersionsResult.data ?? []).map((row) => [
      `${row.rule_id}:${row.version_number}`,
      row,
    ]),
  );

  const programRows = (programResult.data ?? []).map((row) => {
    const currentLevel = (programLevelsResult.data ?? []).find(
      (level) =>
        level.program_id === row.program_id &&
        level.program_version_number === row.program_version_number &&
        level.level_order === row.current_level_order,
    );
    const evaluation = currentLevel
      ? latestEval.get(`${row.student_id}:${currentLevel.rule_id}`)
      : undefined;
    const progress = progressSummary(evaluation?.condition_results);
    return {
      id: row.id,
      studentId: row.student_id,
      name: programMap.get(`${row.program_id}:${row.program_version_number}`) ?? "Programa",
      detail:
        row.status === "completed"
          ? "Programa completado"
          : currentLevel
            ? `Nivel actual: ${currentLevel.title}`
            : "En progreso",
      status: row.status,
      score: row.status === "completed" ? 1 : progress.score,
      missing: row.status === "completed" ? "Objetivo completado." : progress.label,
    };
  });

  const ruleRows = (ruleResult.data ?? [])
    .map((row) => {
      const state = ruleStateMap.get(row.rule_id);
      const version = state
        ? ruleVersionMap.get(`${row.rule_id}:${state.current_version_number}`)
        : undefined;
      const evaluation = latestEval.get(`${row.student_id}:${row.rule_id}`);
      const progress = progressSummary(evaluation?.condition_results);
      return { row, version, progress };
    })
    .filter(({ version }) =>
      type === "challenges"
        ? version?.family === "challenge"
        : version?.family === "achievement",
    )
    .map(({ row, version, progress }) => ({
      id: row.id,
      studentId: row.student_id,
      name: version?.name ?? "Progreso",
      detail: row.status === "fulfilled" ? "Completado" : "En progreso",
      status: row.status,
      score: row.status === "fulfilled" ? 1 : progress.score,
      missing: row.status === "fulfilled" ? "Objetivo completado." : progress.label,
    }));

  const rows = (type === "programs" ? programRows : ruleRows).sort(
    (a, b) => b.score - a.score,
  );
  const closestPendingScore = rows.find((row) => row.score < 1)?.score ?? 0;

  return (
    <RewardsShell>
      <header>
        <p className="eyebrow">SEGUIMIENTO · {ctx.studio.name}</p>
        <h1 className="dashboard-title">Seguimiento</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Observa progreso real. Desde aquí no se puede editar ni fabricar avance.
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_220px_auto]">
        <input
          name="q"
          defaultValue={search}
          placeholder="Buscar alumna"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
        />
        <select
          name="type"
          defaultValue={type}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="programs">Programas</option>
          <option value="challenges">Retos</option>
          <option value="achievements">Logros</option>
        </select>
        <button className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]">
          Aplicar
        </button>
      </form>

      {!rows.length ? (
        <EmptyState title="No hay progreso que coincida con estos filtros" />
      ) : (
        <section className="grid gap-2">
          {rows.map((row) => {
            const student = studentMap.get(row.studentId);
            const closest =
              row.score > 0 && row.score < 1 && row.score === closestPendingScore;
            return (
              <Link
                key={row.id}
                href={`/admin/recompensas/seguimiento/${row.studentId}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 transition hover:border-[#FF0A8A]/35"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-white">{student?.full_name ?? "Alumna"}</strong>
                      {closest ? (
                        <span className="rounded-full border border-[#FF0A8A]/25 bg-[#FF0A8A]/10 px-2 py-0.5 text-[11px] font-semibold text-[#ff64b6]">
                          Más cerca de completar
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      {row.name} · {row.detail}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">{row.missing}</p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
