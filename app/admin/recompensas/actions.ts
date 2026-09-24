"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type ConditionInput = {
  key: string;
  metric: string;
  comparator: string;
  target: number;
};

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "true" || formData.get(key) === "on";
}

function integerValue(formData: FormData, key: string, fallback: number) {
  const raw = textValue(formData, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`invalid_integer:${key}`);
  return value;
}

function optionalDateTime(formData: FormData, key: string) {
  const raw = textValue(formData, key);
  if (!raw) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    ? raw
    : `${raw.length === 16 ? `${raw}:00` : raw}-06:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_date:${key}`);
  return date.toISOString();
}

function parseConditions(formData: FormData) {
  const raw = textValue(formData, "conditions_json");
  if (!raw) throw new Error("reward_conditions_required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("reward_conditions_invalid");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("reward_conditions_invalid");
  }

  const definition = parsed as { operator?: unknown; conditions?: unknown };
  if (definition.operator !== "all" || !Array.isArray(definition.conditions)) {
    throw new Error("reward_conditions_invalid");
  }

  const conditions = definition.conditions.map((value, index): ConditionInput => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("reward_condition_invalid");
    }
    const condition = value as Record<string, unknown>;
    const metric = String(condition.metric ?? "");
    const comparator = String(condition.comparator ?? "");
    const target = Number(condition.target);
    if (
      !metric ||
      !["gte", "eq", "lte"].includes(comparator) ||
      !Number.isFinite(target) ||
      target < 0
    ) {
      throw new Error("reward_condition_invalid");
    }
    if (!metric.startsWith("attendance.") && !metric.startsWith("loyalty.")) {
      throw new Error("reward_metric_invalid");
    }
    return {
      key: `condition_${index + 1}`,
      metric,
      comparator,
      target,
    };
  });

  if (!conditions.length) throw new Error("reward_conditions_required");

  const families = new Set(
    conditions.map((condition) =>
      condition.metric.startsWith("loyalty.") ? "loyalty" : "attendance",
    ),
  );
  if (families.size !== 1) throw new Error("reward_mixed_metric_families");

  return {
    family: [...families][0],
    definition: { operator: "all", conditions },
  };
}

function buildRewardDefinition(
  formData: FormData,
  options?: { forceBadge?: boolean; defaultBadgeTitle?: string },
) {
  const rewards: Array<Record<string, unknown>> = [];
  const badgeEnabled = options?.forceBadge || boolValue(formData, "badge_enabled");

  if (badgeEnabled) {
    const title =
      textValue(formData, "badge_title") || options?.defaultBadgeTitle || "Logro desbloqueado";
    rewards.push({
      key: "achievement",
      kind: "badge",
      delivery: "achievement",
      title,
    });
  }

  if (boolValue(formData, "reward_enabled")) {
    const kind = textValue(formData, "reward_kind");
    const value = integerValue(formData, "reward_value", 1);
    const validityDays = integerValue(formData, "validity_days", 30);
    if (
      ![
        "credits",
        "percentage_discount",
        "fixed_discount",
        "validity_extension",
        "cash",
        "package",
        "custom_manual",
      ].includes(kind)
    ) {
      throw new Error("reward_kind_invalid");
    }
    if (value < 1 || validityDays < 1) throw new Error("reward_value_invalid");

    const label = textValue(formData, "reward_label");
    const benefit: Record<string, unknown> = {
      key: "benefit",
      kind: kind === "cash" ? "custom_manual" : kind === "package" ? "special_benefit" : kind,
      delivery: kind === "validity_extension" ? "auto_apply" : "redeem",
      validity_days: validityDays,
    };
    if (kind === "credits") benefit.credits = value;
    if (kind === "percentage_discount") benefit.percent = value;
    if (kind === "fixed_discount") benefit.amount_minor = value * 100;
    if (kind === "validity_extension") benefit.days = value;
    if (kind === "cash") {
      benefit.benefit_type = "cash";
      benefit.amount_minor = value * 100;
      benefit.currency = "MXN";
      benefit.label = label || `${value.toLocaleString("es-MX")} MXN`;
      benefit.fulfillment = "manual";
    }
    if (kind === "package") {
      benefit.benefit_type = "class_package";
      benefit.class_credits = value;
      benefit.label = label || `Paquete de ${value} clases`;
      benefit.fulfillment = "manual";
    }
    if (kind === "custom_manual") {
      benefit.benefit_type = "custom";
      benefit.label = label || "Recompensa personalizada";
      benefit.fulfillment = "manual";
    }
    rewards.push(benefit);
  }

  return {
    definition: { rewards },
    visibility: textValue(formData, "reward_visibility") === "surprise" ? "surprise" : "visible",
  };
}

function rewardErrorUrl(path: string, error: unknown) {
  const message = error instanceof Error ? error.message : "reward_admin_error";
  return `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

function revalidateRewards() {
  for (const path of [
    "/admin",
    "/admin/empresa",
    "/admin/recompensas",
    "/admin/recompensas/programas",
    "/admin/recompensas/logros",
    "/admin/recompensas/retos",
    "/admin/retos",
    "/student/retos",
    "/admin/recompensas/seguimiento",
    "/admin/recompensas/generadas",
  ]) {
    revalidatePath(path);
  }
}

export async function createProgramAction(formData: FormData) {
  const path = "/admin/recompensas/programas/nuevo";
  let successPath = path;
  try {
    const name = textValue(formData, "name");
    const progressionMode = textValue(formData, "progression_mode");
    if (!name || !["cumulative", "sequential"].includes(progressionMode)) {
      throw new Error("reward_program_invalid");
    }

    const { supabase, studio } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { data, error } = await supabase.rpc("admin_create_reward_program", {
      p_studio_id: studio.id,
      p_name: name,
      p_description: textValue(formData, "description") || null,
      p_progression_mode: progressionMode,
      p_audience_definition: {
        scope:
          textValue(formData, "audience_scope") === "all_students"
            ? "all_students"
            : "all_active_students",
        eligibility_mode:
          textValue(formData, "eligibility_mode") === "lock_on_join"
            ? "lock_on_join"
            : "continuous",
      },
      p_presentation_definition: {},
    });
    if (error || typeof data !== "string") {
      throw new Error(error?.message ?? "reward_program_create_failed");
    }
    revalidateRewards();
    successPath = `/admin/recompensas/programas/${data}?saved=created`;
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(successPath);
}

export async function startProgramVersionAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const path = `/admin/recompensas/programas/${programId}`;
  try {
    if (!programId) throw new Error("reward_program_required");
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_create_reward_program_version", {
      p_program_id: programId,
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=draft_created`);
}

export async function updateProgramDraftAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const path = `/admin/recompensas/programas/${programId}`;
  try {
    const name = textValue(formData, "name");
    const progressionMode = textValue(formData, "progression_mode");
    if (!programId || !name || !["cumulative", "sequential"].includes(progressionMode)) {
      throw new Error("reward_program_invalid");
    }
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_update_reward_program_draft", {
      p_program_id: programId,
      p_name: name,
      p_description: textValue(formData, "description") || null,
      p_progression_mode: progressionMode,
      p_audience_definition: {
        scope:
          textValue(formData, "audience_scope") === "all_students"
            ? "all_students"
            : "all_active_students",
        eligibility_mode:
          textValue(formData, "eligibility_mode") === "lock_on_join"
            ? "lock_on_join"
            : "continuous",
      },
      p_presentation_definition: {},
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=program`);
}

export async function publishProgramAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const path = `/admin/recompensas/programas/${programId}`;
  try {
    if (!programId) throw new Error("reward_program_required");
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_publish_reward_program_with_runtime", {
      p_program_id: programId,
      p_note: textValue(formData, "note") || null,
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=published`);
}

export async function transitionProgramAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const action = textValue(formData, "action");
  const path = `/admin/recompensas/programas/${programId}`;
  try {
    if (!programId || !["pause", "resume", "archive"].includes(action)) {
      throw new Error("reward_program_transition_invalid");
    }
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_transition_reward_program", {
      p_program_id: programId,
      p_action: action,
      p_note: textValue(formData, "note") || null,
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=${action}`);
}

export async function saveProgramLevelAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const originalLevelKey = textValue(formData, "original_level_key");
  const path = programId
    ? `/admin/recompensas/programas/${programId}`
    : "/admin/recompensas/programas";

  try {
    const { family, definition } = parseConditions(formData);
    const levelKey =
      textValue(formData, "level_key") || `nivel_${integerValue(formData, "level_order", 1)}`;
    const title = textValue(formData, "title");
    const levelOrder = integerValue(formData, "level_order", 1);
    if (!programId || !title || levelOrder < 1) throw new Error("reward_program_level_invalid");

    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { data: program, error: programError } = await supabase
      .from("reward_programs")
      .select("studio_id,latest_version_number,published_version_number,status")
      .eq("id", programId)
      .single();
    if (programError || !program)
      throw new Error(programError?.message ?? "reward_program_not_found");
    if (program.latest_version_number === program.published_version_number) {
      throw new Error("reward_program_no_editable_draft");
    }

    const { data: version } = await supabase
      .from("reward_program_versions")
      .select("audience_definition")
      .eq("program_id", programId)
      .eq("version_number", program.latest_version_number)
      .single();
    if (!version) throw new Error("reward_program_version_not_found");

    const outcome = buildRewardDefinition(formData);
    const { data: ruleId, error: ruleError } = await supabase.rpc("admin_create_reward_rule", {
      p_studio_id: program.studio_id,
      p_name: `${title} · ${programId.slice(0, 8)}`,
      p_description: textValue(formData, "description") || null,
      p_family: family,
      p_audience_definition: version.audience_definition,
      p_condition_definition: definition,
      p_evaluation_definition: {
        allow_historical: false,
        attendance_max_one_per_day: true,
      },
      p_cycle_definition: { cadence: "continuous", repeatable: false },
      p_reward_definition: outcome.definition,
      p_presentation_definition: {
        progress_visible: true,
        managed_by_program: true,
        program_id: programId,
        level_key: levelKey,
      },
      p_communication_definition: communication,
      p_human_summary: title,
      p_scheduled_start_at: null,
      p_scheduled_end_at: null,
    });
    if (ruleError || typeof ruleId !== "string") {
      throw new Error(ruleError?.message ?? "reward_program_level_rule_failed");
    }

    const { data: existingLevels } = await supabase
      .from("reward_program_levels")
      .select(
        "level_key,level_order,title,description,rule_id,rule_version_number,level_visibility,reward_visibility,presentation_definition",
      )
      .eq("program_id", programId)
      .eq("program_version_number", program.latest_version_number)
      .order("level_order");

    const previous = (existingLevels ?? []).find(
      (level) => level.level_key === (originalLevelKey || levelKey),
    );

    const levels = (existingLevels ?? [])
      .filter((level) => level.level_key !== (originalLevelKey || levelKey))
      .map((level) => ({
        key: level.level_key,
        order: level.level_order,
        title: level.title,
        description: level.description,
        rule_id: level.rule_id,
        rule_version_number: level.rule_version_number,
        level_visibility: level.level_visibility,
        reward_visibility: level.reward_visibility,
        presentation_definition: level.presentation_definition,
      }));

    levels.push({
      key: levelKey,
      order: levelOrder,
      title,
      description: textValue(formData, "description") || null,
      rule_id: ruleId,
      rule_version_number: 1,
      level_visibility: textValue(formData, "level_visibility") === "hidden" ? "hidden" : "visible",
      reward_visibility: outcome.visibility,
      presentation_definition: {},
    });

    const { error: replaceError } = await supabase.rpc("admin_replace_reward_program_levels", {
      p_program_id: programId,
      p_levels: levels.sort((a, b) => a.order - b.order),
    });
    if (replaceError) throw new Error(replaceError.message);

    if (previous?.rule_id && previous.rule_id !== ruleId) {
      const { data: publishedUse } = program.published_version_number
        ? await supabase
            .from("reward_program_levels")
            .select("id")
            .eq("program_id", programId)
            .eq("program_version_number", program.published_version_number)
            .eq("rule_id", previous.rule_id)
            .maybeSingle()
        : { data: null };
      if (!publishedUse) {
        await supabase.rpc("admin_transition_reward_rule", {
          p_rule_id: previous.rule_id,
          p_action: "cancel",
          p_note: "draft_level_replaced",
        });
      }
    }

    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=level`);
}

export async function deleteProgramLevelAction(formData: FormData) {
  const programId = textValue(formData, "program_id");
  const levelKey = textValue(formData, "level_key");
  const path = `/admin/recompensas/programas/${programId}`;
  try {
    if (!programId || !levelKey) throw new Error("reward_program_level_required");
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { data: program } = await supabase
      .from("reward_programs")
      .select("latest_version_number,published_version_number")
      .eq("id", programId)
      .single();
    if (!program || program.latest_version_number === program.published_version_number) {
      throw new Error("reward_program_no_editable_draft");
    }
    const { data: rows } = await supabase
      .from("reward_program_levels")
      .select(
        "level_key,level_order,title,description,rule_id,rule_version_number,level_visibility,reward_visibility,presentation_definition",
      )
      .eq("program_id", programId)
      .eq("program_version_number", program.latest_version_number)
      .order("level_order");
    const removed = (rows ?? []).find((row) => row.level_key === levelKey);
    const levels = (rows ?? [])
      .filter((row) => row.level_key !== levelKey)
      .map((row, index) => ({
        key: row.level_key,
        order: index + 1,
        title: row.title,
        description: row.description,
        rule_id: row.rule_id,
        rule_version_number: row.rule_version_number,
        level_visibility: row.level_visibility,
        reward_visibility: row.reward_visibility,
        presentation_definition: row.presentation_definition,
      }));
    const { error } = await supabase.rpc("admin_replace_reward_program_levels", {
      p_program_id: programId,
      p_levels: levels,
    });
    if (error) throw new Error(error.message);
    if (removed?.rule_id) {
      const { data: publishedUse } = program.published_version_number
        ? await supabase
            .from("reward_program_levels")
            .select("id")
            .eq("program_id", programId)
            .eq("program_version_number", program.published_version_number)
            .eq("rule_id", removed.rule_id)
            .maybeSingle()
        : { data: null };

      if (!publishedUse) {
        await supabase.rpc("admin_transition_reward_rule", {
          p_rule_id: removed.rule_id,
          p_action: "cancel",
          p_note: "draft_level_removed",
        });
      }
    }
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=level_removed`);
}

async function saveStandaloneRule(formData: FormData, familyOverride: "achievement" | "challenge") {
  const { family, definition } = parseConditions(formData);
  const name = textValue(formData, "name");
  const description = textValue(formData, "description");
  const ruleId = textValue(formData, "rule_id");
  if (!name) throw new Error("reward_rule_name_required");

  const actualFamily = familyOverride === "achievement" ? "achievement" : "challenge";
  const outcome = buildRewardDefinition(formData, {
    forceBadge: familyOverride === "achievement",
    defaultBadgeTitle: name,
  });
  const audience = {
    scope:
      textValue(formData, "audience_scope") === "all_students"
        ? "all_students"
        : "all_active_students",
    eligibility_mode:
      textValue(formData, "eligibility_mode") === "lock_on_join" ? "lock_on_join" : "continuous",
  };
  const challengeMode =
    familyOverride === "challenge" && textValue(formData, "challenge_mode") === "periods"
      ? "periods"
      : "accumulated";
  const periodCadence = ["day", "week", "month"].includes(textValue(formData, "period_cadence"))
    ? textValue(formData, "period_cadence")
    : "week";
  const cycle = {
    cadence: challengeMode === "periods" ? periodCadence : "campaign",
    repeatable: false,
    challenge_mode: challengeMode,
  };
  const competitionMode =
    familyOverride === "challenge" && textValue(formData, "competition_mode") === "leaderboard"
      ? "leaderboard"
      : "individual";
  const tieBreaker = textValue(formData, "tie_breaker") === "shared" ? "shared" : "first_to_reach";
  const rankingMetric = definition.conditions[0]?.metric ?? "attendance.count";
  const communication =
    familyOverride === "challenge"
      ? {
          push: {
            challenge_started: boolValue(formData, "notify_started"),
            meaningful_progress: boolValue(formData, "notify_progress"),
            near_goal: boolValue(formData, "notify_near_goal"),
            entered_top3: boolValue(formData, "notify_top3"),
            position_changed: boolValue(formData, "notify_position"),
            overtaken: boolValue(formData, "notify_overtaken"),
            ending_soon: boolValue(formData, "notify_ending"),
            completed: boolValue(formData, "notify_completed"),
            results: boolValue(formData, "notify_results"),
          },
        }
      : {};
  const presentation = {
    progress_visible: true,
    hidden_until_unlocked:
      familyOverride === "achievement" && boolValue(formData, "secret_achievement"),
    reward_visibility: outcome.visibility,
    condition_family: family,
    challenge_mode: challengeMode,
    competition_mode: competitionMode,
    enrollment_required: familyOverride === "challenge" && competitionMode === "leaderboard",
    ranking_metric: familyOverride === "challenge" ? rankingMetric : null,
    ranking_places: familyOverride === "challenge" && competitionMode === "leaderboard" ? 3 : null,
    tie_breaker:
      familyOverride === "challenge" && competitionMode === "leaderboard" ? tieBreaker : null,
    winner_count:
      familyOverride === "challenge" && competitionMode === "leaderboard"
        ? Math.min(3, Math.max(1, integerValue(formData, "winner_count", 1)))
        : null,
    competition_reward_definition:
      familyOverride === "challenge" && competitionMode === "leaderboard"
        ? outcome.definition
        : null,
    cover_url: textValue(formData, "cover_url") || null,
  };
  const ruleRewardDefinition =
    familyOverride === "challenge" && competitionMode === "leaderboard"
      ? { rewards: [] }
      : outcome.definition;
  const evaluation = {
    allow_historical: false,
    attendance_max_one_per_day: true,
  };
  const scheduledStartAt = optionalDateTime(formData, "scheduled_start_at");
  const scheduledEndAt = optionalDateTime(formData, "scheduled_end_at");

  const { supabase, studio } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);

  if (ruleId) {
    const { data: rule } = await supabase
      .from("reward_rules")
      .select("status")
      .eq("id", ruleId)
      .eq("studio_id", studio.id)
      .single();
    if (!rule) throw new Error("reward_rule_not_found");
    if (rule.status === "active" || rule.status === "paused") {
      throw new Error("reward_active_structural_locked");
    }
    const { error } = await supabase.rpc("admin_create_reward_rule_version", {
      p_rule_id: ruleId,
      p_name: name,
      p_description: description || null,
      p_family: actualFamily,
      p_audience_definition: audience,
      p_condition_definition: definition,
      p_evaluation_definition: evaluation,
      p_cycle_definition: cycle,
      p_reward_definition: ruleRewardDefinition,
      p_presentation_definition: presentation,
      p_communication_definition: communication,
      p_human_summary: name,
      p_scheduled_start_at: scheduledStartAt,
      p_scheduled_end_at: scheduledEndAt,
    });
    if (error) throw new Error(error.message);
    return ruleId;
  }

  const { data, error } = await supabase.rpc("admin_create_reward_rule", {
    p_studio_id: studio.id,
    p_name: name,
    p_description: description || null,
    p_family: actualFamily,
    p_audience_definition: audience,
    p_condition_definition: definition,
    p_evaluation_definition: evaluation,
    p_cycle_definition: cycle,
    p_reward_definition: ruleRewardDefinition,
    p_presentation_definition: presentation,
    p_communication_definition: communication,
    p_human_summary: name,
    p_scheduled_start_at: scheduledStartAt,
    p_scheduled_end_at: scheduledEndAt,
  });
  if (error || typeof data !== "string") {
    throw new Error(error?.message ?? "reward_rule_create_failed");
  }
  return data;
}

export async function saveAchievementAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  const base = ruleId ? `/admin/recompensas/logros/${ruleId}` : "/admin/recompensas/logros/nuevo";
  let successPath = base;
  try {
    const id = await saveStandaloneRule(formData, "achievement");
    revalidateRewards();
    successPath = `/admin/recompensas/logros/${id}?saved=rule`;
  } catch (error) {
    redirect(rewardErrorUrl(base, error));
  }
  redirect(successPath);
}

export async function saveChallengeAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  const base = ruleId ? `/admin/retos/${ruleId}` : "/admin/retos/nuevo";
  let successPath = base;
  try {
    const id = await saveStandaloneRule(formData, "challenge");
    revalidateRewards();
    successPath = `/admin/retos/${id}?saved=rule`;
  } catch (error) {
    redirect(rewardErrorUrl(base, error));
  }
  redirect(successPath);
}

export async function transitionStandaloneRuleAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  const isAchievement = textValue(formData, "kind") === "achievement";
  const kind = isAchievement ? "logros" : "retos";
  const action = textValue(formData, "action");
  const path = isAchievement ? `/admin/recompensas/${kind}/${ruleId}` : `/admin/retos/${ruleId}`;
  try {
    if (!ruleId || !["schedule", "activate", "finish", "cancel"].includes(action)) {
      throw new Error("reward_rule_transition_invalid");
    }
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);

    let settledCompetitive = false;
    if (!isAchievement && action === "finish") {
      const { error: settlementError } = await supabase.rpc("admin_settle_reward_challenge", {
        p_rule_id: ruleId,
      });

      if (!settlementError) {
        settledCompetitive = true;
      } else if (!settlementError.message.includes("challenge_not_competitive")) {
        throw new Error(settlementError.message);
      }
    }

    if (!settledCompetitive) {
      const { error } = await supabase.rpc("admin_transition_reward_rule", {
        p_rule_id: ruleId,
        p_action: action,
        p_note: textValue(formData, "note") || null,
      });
      if (error) throw new Error(error.message);
    }
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=${action}`);
}

export async function updateStandaloneCopyAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  const isAchievement = textValue(formData, "kind") === "achievement";
  const kind = isAchievement ? "logros" : "retos";
  const path = isAchievement ? `/admin/recompensas/${kind}/${ruleId}` : `/admin/retos/${ruleId}`;
  try {
    const title = textValue(formData, "name");
    if (!ruleId || !title) throw new Error("reward_rule_title_required");
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_update_reward_rule_copy", {
      p_rule_id: ruleId,
      p_title: title,
      p_description: textValue(formData, "description") || null,
      p_cover_url: textValue(formData, "cover_url") || null,
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=copy`);
}

export async function adjustRewardAction(formData: FormData) {
  const rewardId = textValue(formData, "reward_id");
  const reason = textValue(formData, "reason");
  const path = `/admin/recompensas/generadas/${rewardId}`;
  try {
    if (!rewardId || !reason) throw new Error("reward_adjustment_reason_required");
    const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
    const { error } = await supabase.rpc("admin_adjust_reward_instance", {
      p_reward_instance_id: rewardId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    revalidateRewards();
    revalidatePath(path);
  } catch (error) {
    redirect(rewardErrorUrl(path, error));
  }
  redirect(`${path}?saved=adjusted`);
}
