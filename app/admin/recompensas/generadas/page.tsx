import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import {
  EmptyState,
  StatusBadge,
  formatDateTime,
  rewardDefinitionLabel,
} from "../ui";

export default async function GeneratedRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; origin?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const status = ["available", "reserved", "redeemed", "expired", "revoked"].includes(
    String(query.status),
  )
    ? String(query.status)
    : "";
  const origin = ["program", "challenge", "achievement", "other"].includes(String(query.origin))
    ? String(query.origin)
    : "";

  let rewardsQuery = ctx.supabase
    .from("reward_instances")
    .select(
      "id,student_id,rule_id,version_number,status,kind,benefit_definition,expires_at,created_at,revoked_reason",
    )
    .eq("studio_id", ctx.studio.id)
    .order("created_at", { ascending: false })
    .limit(250);
  if (status) rewardsQuery = rewardsQuery.eq("status", status);
  const { data: rawRewards } = await rewardsQuery;

  const rewardsBase = rawRewards ?? [];
  const ruleIds = [
    ...new Set(rewardsBase.flatMap((reward) => (reward.rule_id ? [reward.rule_id] : []))),
  ];

  const [ruleVersionsResult, programLevelsResult] = ruleIds.length
    ? await Promise.all([
        ctx.supabase
          .from("reward_rule_versions")
          .select("rule_id,version_number,name,family")
          .in("rule_id", ruleIds),
        ctx.supabase
          .from("reward_program_levels")
          .select("rule_id,rule_version_number,program_id,program_version_number,title")
          .in("rule_id", ruleIds),
      ])
    : [{ data: [] }, { data: [] }];

  const ruleVersionMap = new Map(
    (ruleVersionsResult.data ?? []).map((version) => [
      `${version.rule_id}:${version.version_number}`,
      version,
    ]),
  );
  const programLevelMap = new Map(
    (programLevelsResult.data ?? []).map((level) => [
      `${level.rule_id}:${level.rule_version_number}`,
      level,
    ]),
  );

  const programIds = [
    ...new Set((programLevelsResult.data ?? []).map((level) => level.program_id)),
  ];
  const programVersionsResult = programIds.length
    ? await ctx.supabase
        .from("reward_program_versions")
        .select("program_id,version_number,name")
        .in("program_id", programIds)
    : { data: [] };
  const programVersionMap = new Map(
    (programVersionsResult.data ?? []).map((version) => [
      `${version.program_id}:${version.version_number}`,
      version,
    ]),
  );

  const decorated = rewardsBase.map((reward) => {
    const key = reward.rule_id && reward.version_number
      ? `${reward.rule_id}:${reward.version_number}`
      : "";
    const ruleVersion = key ? ruleVersionMap.get(key) : undefined;
    const programLevel = key ? programLevelMap.get(key) : undefined;

    if (programLevel) {
      const program = programVersionMap.get(
        `${programLevel.program_id}:${programLevel.program_version_number}`,
      );
      return {
        reward,
        originType: "program",
        originLabel: `${program?.name ?? "Programa"} · ${programLevel.title}`,
      };
    }

    if (ruleVersion?.family === "challenge") {
      return { reward, originType: "challenge", originLabel: ruleVersion.name };
    }
    if (ruleVersion?.family === "achievement") {
      return { reward, originType: "achievement", originLabel: ruleVersion.name };
    }
    return {
      reward,
      originType: "other",
      originLabel: ruleVersion?.name ?? "Origen automático",
    };
  });

  const rows = decorated.filter((item) => !origin || item.originType === origin);
  const studentIds = [...new Set(rows.map((item) => item.reward.student_id))];
  const studentsResult = studentIds.length
    ? await ctx.supabase
        .from("students")
        .select("id,full_name")
        .eq("studio_id", ctx.studio.id)
        .in("id", studentIds)
    : { data: [] };
  const studentMap = new Map((studentsResult.data ?? []).map((student) => [student.id, student]));

  return (
    <RewardsShell>
      <header>
        <p className="eyebrow">RECOMPENSAS GENERADAS · {ctx.studio.name}</p>
        <h1 className="dashboard-title">Recompensas generadas</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Aquí se revisan recompensas ya creadas por el sistema. No se crean recompensas manuales.
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[220px_220px_auto]">
        <select
          name="status"
          defaultValue={status}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="">Todos los estados</option>
          <option value="available">Disponible</option>
          <option value="reserved">En uso</option>
          <option value="redeemed">Utilizada</option>
          <option value="expired">Vencida</option>
          <option value="revoked">Ajustada</option>
        </select>
        <select
          name="origin"
          defaultValue={origin}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="">Todos los orígenes</option>
          <option value="program">Programa</option>
          <option value="challenge">Reto</option>
          <option value="achievement">Logro</option>
          <option value="other">Otro</option>
        </select>
        <button className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]">
          Filtrar
        </button>
      </form>

      {!rows.length ? (
        <EmptyState title="No hay recompensas con estos filtros" />
      ) : (
        <section className="grid gap-2">
          {rows.map(({ reward, originLabel, originType }) => (
            <Link
              key={reward.id}
              href={`/admin/recompensas/generadas/${reward.id}`}
              className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 transition hover:border-[#FF0A8A]/35 md:grid-cols-[1.3fr_1fr_auto] md:items-center"
            >
              <div>
                <strong className="text-white">
                  {rewardDefinitionLabel(reward.benefit_definition)}
                </strong>
                <p className="mt-1 text-sm text-zinc-400">
                  {studentMap.get(reward.student_id)?.full_name ?? "Alumna"}
                </p>
              </div>
              <div className="text-sm text-zinc-400">
                <p>{originLabel}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                  {originType === "program"
                    ? "Programa"
                    : originType === "challenge"
                      ? "Reto"
                      : originType === "achievement"
                        ? "Logro"
                        : "Otro"}{" "}
                  · {formatDateTime(reward.created_at)}
                </p>
              </div>
              <StatusBadge status={reward.status} />
            </Link>
          ))}
        </section>
      )}
    </RewardsShell>
  );
}
