import "server-only";

import { cache } from "react";

import { getStudentPortalContext } from "./portal";
import {
  exactMissingLabel,
  isNearComplete,
  isStudentRewardProgressActive,
  singleNumericProgress,
  type StudentConditionProgress,
} from "./reward-progress-ui";

export {
  exactMissingLabel,
  isNearComplete,
  isStudentRewardProgressActive,
  singleNumericProgress,
  type StudentConditionProgress,
} from "./reward-progress-ui";

export type RewardJson = Record<string, unknown>;

export type StudentRewardRule = {
  id: string;
  status: string;
  current_version_number: number;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};

export type StudentRewardVersion = {
  rule_id: string;
  version_number: number;
  name: string;
  description: string | null;
  family: string;
  condition_definition: RewardJson;
  evaluation_definition: RewardJson;
  cycle_definition: RewardJson;
  reward_definition: RewardJson;
  presentation_definition: RewardJson;
  human_summary: string;
};

export type StudentRewardParticipation = {
  id: string;
  rule_id: string;
  student_id: string;
  joined_version_number: number;
  status: string;
  joined_at: string;
  fulfilled_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

export type StudentRewardCycle = {
  id: string;
  participation_id: string;
  rule_id: string;
  student_id: string;
  version_number: number;
  cycle_key: string;
  status: string;
  window_start_at: string | null;
  window_end_at: string | null;
  frozen_at: string | null;
  fulfilled_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

export type StudentRewardSnapshot = {
  id: string;
  cycle_id: string;
  progress: RewardJson;
  evidence_summary: RewardJson;
  source_through: string | null;
  calculated_at: string;
};

export type StudentRewardInstance = {
  id: string;
  rule_id: string | null;
  version_number: number | null;
  cycle_id: string | null;
  kind: string;
  status: string;
  reward_key: string | null;
  delivery_mode: string;
  benefit_definition: RewardJson;
  origin_snapshot: RewardJson;
  available_from: string | null;
  expires_at: string | null;
  reserved_at: string | null;
  reserved_until: string | null;
  reservation_context: RewardJson;
  redeemed_at: string | null;
  redemption_context: RewardJson;
  revoked_at: string | null;
  manually_granted: boolean;
  created_at: string;
};

export type StudentAchievementUnlock = {
  id: string;
  rule_id: string;
  version_number: number;
  achievement_key: string;
  level_key: string | null;
  title_snapshot: string;
  badge_snapshot: RewardJson;
  unlocked_at: string;
};

export function rewardObject(value: unknown): RewardJson {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RewardJson)
    : {};
}

export function rewardStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked: "Próximamente",
    available: "Disponible",
    reserved: "En uso",
    redeemed: "Utilizada",
    expired: "Vencida",
    revoked: "Ajustada",
  };
  return labels[status] ?? status;
}

export function rewardStatusClass(status: string) {
  if (status === "available") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (status === "reserved") return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  if (status === "revoked") return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  if (["redeemed", "expired"].includes(status)) {
    return "border-zinc-500/20 bg-zinc-500/10 text-zinc-400";
  }
  return "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-200";
}

export function familyLabel(family: string) {
  const labels: Record<string, string> = {
    loyalty: "Fidelidad",
    attendance: "Constancia",
    challenge: "Reto",
    achievement: "Logro",
  };
  return labels[family] ?? "Rewards";
}

export function rewardBenefitLabel(
  reward: Pick<StudentRewardInstance, "kind" | "benefit_definition">,
) {
  const definition = rewardObject(reward.benefit_definition);

  if (reward.kind === "percentage_discount") {
    return `${Number(definition.percent ?? 0)}% de descuento`;
  }
  if (reward.kind === "fixed_discount") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(Number(definition.amount_minor ?? 0) / 100);
  }
  if (reward.kind === "credits") {
    const credits = Number(definition.credits ?? 0);
    return `${credits} crédito${credits === 1 ? "" : "s"}`;
  }
  if (reward.kind === "validity_extension") {
    const days = Number(definition.days ?? 0);
    return `${days} día${days === 1 ? "" : "s"} extra${days === 1 ? "" : "s"}`;
  }
  if (reward.kind === "surcharge_waiver") {
    return String(definition.label ?? "Sin recargo");
  }
  if (reward.kind === "badge") {
    return String(definition.title ?? definition.label ?? "Insignia");
  }
  return String(definition.label ?? definition.description ?? "Beneficio especial");
}

export function rewardDefinitionLabel(value: unknown) {
  const definition = rewardObject(value);
  const rewards = Array.isArray(definition.rewards) ? definition.rewards : [];
  const primary = rewards.length ? rewardObject(rewards[0]) : definition;
  const kind = String(primary.kind ?? "custom_manual");

  return rewardBenefitLabel({
    kind,
    benefit_definition: primary,
  });
}

export function metricLabel(metric: string) {
  const labels: Record<string, string> = {
    "loyalty.current_consecutive_periods": "Periodos consecutivos",
    "loyalty.total_paid_periods": "Periodos pagados",
    "loyalty.best_consecutive_periods": "Mejor racha de periodos",
    "loyalty.active_coverage": "Paquete vigente",
    "loyalty.in_grace": "Dentro del periodo de gracia",
    "attendance.count": "Asistencias",
    "attendance.raw_count": "Asistencias registradas",
    "attendance.distinct_days": "Días distintos",
    "attendance.distinct_weeks": "Semanas distintas",
    "attendance.distinct_months": "Meses distintos",
    "attendance.distinct_disciplines": "Disciplinas distintas",
    "attendance.streak.days.current": "Racha de días",
    "attendance.streak.weeks.current": "Racha de semanas",
    "attendance.streak.months.current": "Racha de meses",
  };

  if (labels[metric]) return labels[metric];
  if (metric.startsWith("attendance.discipline.")) return "Asistencias en disciplina";
  return metric
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\\b\\w/g, (character) => character.toUpperCase());
}

function compare(current: unknown, comparator: string, target: unknown) {
  switch (comparator) {
    case "eq":
      return current === target;
    case "neq":
      return current !== target;
    case "gte":
      return typeof current === "number" && typeof target === "number" && current >= target;
    case "gt":
      return typeof current === "number" && typeof target === "number" && current > target;
    case "lte":
      return typeof current === "number" && typeof target === "number" && current <= target;
    case "lt":
      return typeof current === "number" && typeof target === "number" && current < target;
    default:
      return false;
  }
}

export function conditionProgress(
  version: StudentRewardVersion,
  snapshot: StudentRewardSnapshot | null,
): StudentConditionProgress[] {
  const definition = rewardObject(version.condition_definition);
  const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
  const progress = rewardObject(snapshot?.progress);

  return conditions.map((raw, index) => {
    const condition = rewardObject(raw);
    const metric = String(condition.metric ?? "");
    const comparator = String(condition.comparator ?? "gte");
    const target = condition.target;
    const current = progress[metric];

    return {
      key: String(condition.key ?? `condition-${index + 1}`),
      metric,
      label: metricLabel(metric),
      comparator,
      target,
      current,
      completed: compare(current, comparator, target),
    };
  });
}

export function rewardAppliesTo(definitionValue: unknown) {
  const definition = rewardObject(definitionValue);
  const labels = Array.isArray(definition.applies_to)
    ? definition.applies_to.map(String).filter(Boolean)
    : [];

  if (labels.length) return labels.join(" · ");
  if (typeof definition.applies_to === "string" && definition.applies_to) {
    return definition.applies_to;
  }
  return "Compras elegibles en Studio Flow";
}

export function rewardStackability(definitionValue: unknown) {
  const definition = rewardObject(definitionValue);
  return definition.stackable === true
    ? "Puede combinarse con beneficios compatibles"
    : "Se usa de forma individual";
}

export function actualRewardSavingsMinor(reward: StudentRewardInstance) {
  const context = rewardObject(reward.redemption_context);
  const value =
    context.actual_savings_minor ?? context.actual_benefit_minor ?? context.discount_minor ?? null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const getStudentRewardsContext = cache(async () => {
  const portal = await getStudentPortalContext();
  const studentId = portal.snapshot.profile.student_id;
  const studioId = portal.membership.studio_id;

  const [rewardsResult, participationsResult, cyclesResult, achievementsResult] = await Promise.all(
    [
      portal.supabase
        .from("reward_instances")
        .select(
          "id,rule_id,version_number,cycle_id,kind,status,reward_key,delivery_mode,benefit_definition,origin_snapshot,available_from,expires_at,reserved_at,reserved_until,reservation_context,redeemed_at,redemption_context,revoked_at,manually_granted,created_at",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
      portal.supabase
        .from("reward_participations")
        .select(
          "id,rule_id,student_id,joined_version_number,status,joined_at,fulfilled_at,closed_at,updated_at",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("updated_at", { ascending: false }),
      portal.supabase
        .from("reward_cycles")
        .select(
          "id,participation_id,rule_id,student_id,version_number,cycle_key,status,window_start_at,window_end_at,frozen_at,fulfilled_at,closed_at,updated_at",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("updated_at", { ascending: false }),
      portal.supabase
        .from("reward_achievement_unlocks")
        .select(
          "id,rule_id,version_number,achievement_key,level_key,title_snapshot,badge_snapshot,unlocked_at",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("unlocked_at", { ascending: false }),
    ],
  );

  if (
    rewardsResult.error ||
    participationsResult.error ||
    cyclesResult.error ||
    achievementsResult.error
  ) {
    throw new Error("student_rewards_load_failed");
  }

  const rewards = (rewardsResult.data ?? []) as StudentRewardInstance[];
  const participations = (participationsResult.data ?? []) as StudentRewardParticipation[];
  const cycles = (cyclesResult.data ?? []) as StudentRewardCycle[];
  const achievements = (achievementsResult.data ?? []) as StudentAchievementUnlock[];

  const ruleIds = [
    ...new Set(
      [
        ...participations.map((item) => item.rule_id),
        ...rewards.map((item) => item.rule_id).filter(Boolean),
        ...achievements.map((item) => item.rule_id),
      ].filter(Boolean) as string[],
    ),
  ];

  const [rulesResult, versionsResult] = ruleIds.length
    ? await Promise.all([
        portal.supabase
          .from("reward_rules")
          .select("id,status,current_version_number,scheduled_start_at,scheduled_end_at")
          .in("id", ruleIds),
        portal.supabase
          .from("reward_rule_versions")
          .select(
            "rule_id,version_number,name,description,family,condition_definition,evaluation_definition,cycle_definition,reward_definition,presentation_definition,human_summary",
          )
          .in("rule_id", ruleIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (rulesResult.error || versionsResult.error) {
    throw new Error("student_reward_rules_load_failed");
  }

  const cycleIds = cycles.map((cycle) => cycle.id);
  const snapshotsResult = cycleIds.length
    ? await portal.supabase
        .from("reward_progress_snapshots")
        .select("id,cycle_id,progress,evidence_summary,source_through,calculated_at")
        .in("cycle_id", cycleIds)
        .order("calculated_at", { ascending: false })
    : { data: [], error: null };

  if (snapshotsResult.error) throw new Error("student_reward_progress_load_failed");

  const rules = (rulesResult.data ?? []) as StudentRewardRule[];
  const versions = (versionsResult.data ?? []) as StudentRewardVersion[];
  const snapshots = (snapshotsResult.data ?? []) as StudentRewardSnapshot[];

  const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
  const versionMap = new Map(
    versions.map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );

  const latestCycleByParticipation = new Map<string, StudentRewardCycle>();
  for (const cycle of cycles) {
    if (!latestCycleByParticipation.has(cycle.participation_id)) {
      latestCycleByParticipation.set(cycle.participation_id, cycle);
    }
  }

  const latestSnapshotByCycle = new Map<string, StudentRewardSnapshot>();
  for (const snapshot of snapshots) {
    if (!latestSnapshotByCycle.has(snapshot.cycle_id)) {
      latestSnapshotByCycle.set(snapshot.cycle_id, snapshot);
    }
  }

  return {
    ...portal,
    rewards,
    participations,
    cycles,
    achievements,
    rules,
    versions,
    snapshots,
    ruleMap,
    versionMap,
    latestCycleByParticipation,
    latestSnapshotByCycle,
  };
});
