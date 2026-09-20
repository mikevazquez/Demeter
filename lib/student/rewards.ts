import { cache } from "react";

import { getStudentPortalContext } from "@/lib/student/portal";

import type { StudentConditionProgress } from "./reward-progress-ui";

type JsonObject = Record<string, unknown>;

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
  condition_definition: unknown;
  evaluation_definition: unknown;
  cycle_definition: unknown;
  reward_definition: unknown;
  presentation_definition: unknown;
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
  progress: unknown;
  evidence_summary: unknown;
  source_through: string | null;
  calculated_at: string;
};

export type StudentAchievementUnlock = {
  id: string;
  rule_id: string;
  version_number: number;
  achievement_key: string;
  level_key: string | null;
  title_snapshot: string;
  badge_snapshot: unknown;
  unlocked_at: string;
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
  benefit_definition: unknown;
  origin_snapshot: unknown;
  available_from: string | null;
  expires_at: string | null;
  reserved_at: string | null;
  reserved_until: string | null;
  reservation_context: unknown;
  redeemed_at: string | null;
  redemption_context: unknown;
  revoked_at: string | null;
  revoked_reason: string | null;
  manually_granted: boolean;
  created_at: string;
};

export type StudentRewardInstanceEvent = {
  id: string;
  reward_instance_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  details: unknown;
  occurred_at: string;
};

export type StudentRewardProgram = {
  id: string;
  status: string;
  latest_version_number: number;
  published_version_number: number | null;
};

export type StudentRewardProgramVersion = {
  program_id: string;
  version_number: number;
  name: string;
  description: string | null;
  progression_mode: string;
  audience_definition: unknown;
  presentation_definition: unknown;
};

export type StudentRewardProgramLevel = {
  id: string;
  program_id: string;
  program_version_number: number;
  level_key: string;
  level_order: number;
  title: string;
  description: string | null;
  rule_id: string;
  rule_version_number: number;
  level_visibility: string;
  reward_visibility: string;
  presentation_definition: unknown;
};

export type StudentRewardProgramParticipation = {
  id: string;
  program_id: string;
  student_id: string;
  program_version_number: number;
  status: string;
  current_level_order: number | null;
  joined_at: string;
  completed_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

export type StudentRewardProgramUnlock = {
  id: string;
  participation_id: string;
  program_id: string;
  student_id: string;
  program_version_number: number;
  level_id: string;
  level_key_snapshot: string;
  level_order_snapshot: number;
  title_snapshot: string;
  unlocked_at: string;
};

export type StudentRewardProgramEvent = {
  id: string;
  program_id: string;
  participation_id: string | null;
  student_id: string | null;
  program_version_number: number;
  level_id: string | null;
  event_type: string;
  details: unknown;
  occurred_at: string;
};

export function rewardObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
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

export function rewardBenefitLabel(reward: Pick<StudentRewardInstance, "kind" | "benefit_definition">) {
  const definition = rewardObject(reward.benefit_definition);

  if (reward.kind === "fixed_discount") {
    const amount = Number(definition.amount_minor ?? 0) / 100;
    return `$${amount.toLocaleString("es-MX")} de descuento`;
  }
  if (reward.kind === "percentage_discount") {
    return `${Number(definition.percentage ?? 0)}% de descuento`;
  }
  if (reward.kind === "credits") {
    const credits = Number(definition.credits ?? 0);
    return `${credits} crédito${credits === 1 ? "" : "s"} de clase`;
  }
  if (reward.kind === "validity_extension") {
    const days = Number(definition.days ?? 0);
    return `${days} día${days === 1 ? "" : "s"} extra de vigencia`;
  }
  if (reward.kind === "surcharge_waiver") {
    return String(definition.label ?? "Sin recargo");
  }
  if (reward.kind === "badge") {
    return String(definition.title ?? definition.label ?? "Medalla");
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
    "attendance.count": "Clases completadas",
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
  if (metric.startsWith("attendance.discipline.")) return "Clases de disciplina";
  return metric
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  return "Compras elegibles en Demeter";
}

export function rewardStackability(definitionValue: unknown) {
  const definition = rewardObject(definitionValue);
  return definition.stackable === true
    ? "Puede combinarse con beneficios compatibles"
    : "No acumulable con otras promociones";
}

export function isChallengeVersion(version: StudentRewardVersion | undefined) {
  if (!version || version.family === "achievement" || version.family === "loyalty") return false;
  const presentation = rewardObject(version.presentation_definition);
  return Boolean(presentation.challenge_mode);
}

export const getStudentRewardsContext = cache(async () => {
  const portal = await getStudentPortalContext();
  const studentId = portal.snapshot.profile.student_id;
  const studioId = portal.membership.studio_id;

  const [
    rewardsResult,
    participationsResult,
    cyclesResult,
    achievementsResult,
    programParticipationsResult,
    programUnlocksResult,
    programEventsResult,
  ] = await Promise.all([
    portal.supabase
      .from("reward_instances")
      .select(
        "id,rule_id,version_number,cycle_id,kind,status,reward_key,delivery_mode,benefit_definition,origin_snapshot,available_from,expires_at,reserved_at,reserved_until,reservation_context,redeemed_at,redemption_context,revoked_at,revoked_reason,manually_granted,created_at",
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
        "id,participation_id,rule_id,student_id,version_number,status,window_start_at,window_end_at,frozen_at,fulfilled_at,closed_at,updated_at",
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
    portal.supabase
      .from("reward_program_participations")
      .select(
        "id,program_id,student_id,program_version_number,status,current_level_order,joined_at,completed_at,closed_at,updated_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("updated_at", { ascending: false }),
    portal.supabase
      .from("reward_program_level_unlocks")
      .select(
        "id,participation_id,program_id,student_id,program_version_number,level_id,level_key_snapshot,level_order_snapshot,title_snapshot,unlocked_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("unlocked_at", { ascending: false }),
    portal.supabase
      .from("reward_program_events")
      .select(
        "id,program_id,participation_id,student_id,program_version_number,level_id,event_type,details,occurred_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("occurred_at", { ascending: false }),
  ]);

  const firstError = [
    rewardsResult.error,
    participationsResult.error,
    cyclesResult.error,
    achievementsResult.error,
    programParticipationsResult.error,
    programUnlocksResult.error,
    programEventsResult.error,
  ].find(Boolean);

  if (firstError) throw new Error("student_rewards_load_failed");

  const rewards = (rewardsResult.data ?? []) as StudentRewardInstance[];
  const participations = (participationsResult.data ?? []) as StudentRewardParticipation[];
  const cycles = (cyclesResult.data ?? []) as StudentRewardCycle[];
  const achievements = (achievementsResult.data ?? []) as StudentAchievementUnlock[];
  const programParticipations = (programParticipationsResult.data ??
    []) as StudentRewardProgramParticipation[];
  const programUnlocks = (programUnlocksResult.data ?? []) as StudentRewardProgramUnlock[];
  const programEvents = (programEventsResult.data ?? []) as StudentRewardProgramEvent[];

  const programIds = [...new Set(programParticipations.map((item) => item.program_id))];

  const [programsResult, programVersionsResult, programLevelsResult] = programIds.length
    ? await Promise.all([
        portal.supabase
          .from("reward_programs")
          .select("id,status,latest_version_number,published_version_number")
          .in("id", programIds),
        portal.supabase
          .from("reward_program_versions")
          .select(
            "program_id,version_number,name,description,progression_mode,audience_definition,presentation_definition",
          )
          .in("program_id", programIds),
        portal.supabase
          .from("reward_program_levels")
          .select(
            "id,program_id,program_version_number,level_key,level_order,title,description,rule_id,rule_version_number,level_visibility,reward_visibility,presentation_definition",
          )
          .in("program_id", programIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (programsResult.error || programVersionsResult.error || programLevelsResult.error) {
    throw new Error("student_reward_programs_load_failed");
  }

  const programs = (programsResult.data ?? []) as StudentRewardProgram[];
  const programVersions = (programVersionsResult.data ?? []) as StudentRewardProgramVersion[];
  const programLevels = (programLevelsResult.data ?? []) as StudentRewardProgramLevel[];

  const ruleIds = [
    ...new Set(
      [
        ...participations.map((item) => item.rule_id),
        ...rewards.map((item) => item.rule_id).filter(Boolean),
        ...achievements.map((item) => item.rule_id),
        ...programLevels.map((item) => item.rule_id),
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

  if (rulesResult.error || versionsResult.error) throw new Error("student_reward_rules_load_failed");

  const cycleIds = cycles.map((cycle) => cycle.id);
  const rewardIds = rewards.map((reward) => reward.id);

  const [snapshotsResult, rewardEventsResult] = await Promise.all([
    cycleIds.length
      ? portal.supabase
          .from("reward_progress_snapshots")
          .select("id,cycle_id,progress,evidence_summary,source_through,calculated_at")
          .in("cycle_id", cycleIds)
          .order("calculated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    rewardIds.length
      ? portal.supabase
          .from("reward_instance_events")
          .select(
            "id,reward_instance_id,event_type,from_status,to_status,details,occurred_at",
          )
          .in("reward_instance_id", rewardIds)
          .order("occurred_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (snapshotsResult.error || rewardEventsResult.error) {
    throw new Error("student_reward_history_load_failed");
  }

  const rules = (rulesResult.data ?? []) as StudentRewardRule[];
  const versions = (versionsResult.data ?? []) as StudentRewardVersion[];
  const snapshots = (snapshotsResult.data ?? []) as StudentRewardSnapshot[];
  const rewardEvents = (rewardEventsResult.data ?? []) as StudentRewardInstanceEvent[];

  const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
  const versionMap = new Map(
    versions.map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );
  const programMap = new Map(programs.map((program) => [program.id, program]));
  const programVersionMap = new Map(
    programVersions.map((version) => [
      `${version.program_id}:${version.version_number}`,
      version,
    ]),
  );

  const levelsByProgramVersion = new Map<string, StudentRewardProgramLevel[]>();
  for (const level of programLevels) {
    const key = `${level.program_id}:${level.program_version_number}`;
    const levels = levelsByProgramVersion.get(key) ?? [];
    levels.push(level);
    levelsByProgramVersion.set(
      key,
      levels.sort((left, right) => left.level_order - right.level_order),
    );
  }

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

  const ruleParticipationByRule = new Map<string, StudentRewardParticipation>();
  for (const participation of participations) {
    if (!ruleParticipationByRule.has(participation.rule_id)) {
      ruleParticipationByRule.set(participation.rule_id, participation);
    }
  }

  const programRuleIds = new Set(programLevels.map((level) => level.rule_id));

  return {
    ...portal,
    rewards,
    rewardEvents,
    participations,
    cycles,
    achievements,
    snapshots,
    rules,
    versions,
    programParticipations,
    programUnlocks,
    programEvents,
    programs,
    programVersions,
    programLevels,
    ruleMap,
    versionMap,
    programMap,
    programVersionMap,
    levelsByProgramVersion,
    latestCycleByParticipation,
    latestSnapshotByCycle,
    ruleParticipationByRule,
    programRuleIds,
  };
});
