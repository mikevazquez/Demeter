"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const families = new Set(["loyalty", "attendance", "challenge", "achievement"]);
const comparators = new Set(["eq", "neq", "gte", "lte", "gt", "lt"]);
const rewardKinds = new Set([
  "percentage_discount",
  "fixed_discount",
  "credits",
  "validity_extension",
  "surcharge_waiver",
  "special_benefit",
  "badge",
  "custom_manual",
]);

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const raw = textValue(formData, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`reward_invalid_number:${key}`);
  return value;
}

function optionalInteger(formData: FormData, key: string) {
  const raw = textValue(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`reward_invalid_integer:${key}`);
  return value;
}

function optionalDateTime(formData: FormData, key: string) {
  const raw = textValue(formData, key);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`reward_invalid_date:${key}`);
  return date.toISOString();
}

function ruleUrl(ruleId: string, params?: Record<string, string>) {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/admin/recompensas/reglas/${encodeURIComponent(ruleId)}${search}`;
}

function parseRuleDefinition(formData: FormData) {
  const name = textValue(formData, "name");
  const description = textValue(formData, "description");
  const family = textValue(formData, "family");
  const operator = textValue(formData, "operator") || "all";
  const metric = textValue(formData, "metric");
  const comparator = textValue(formData, "comparator") || "gte";
  const target = numberValue(formData, "target", 1);
  const audienceScope = textValue(formData, "audience_scope") || "all_active_students";
  const cadence = textValue(formData, "cadence") || "continuous";
  const rewardKind = textValue(formData, "reward_kind") || "credits";
  const rewardValue = numberValue(formData, "reward_value", 1);
  const validityDays = optionalInteger(formData, "validity_days");
  const graceDays = optionalInteger(formData, "grace_days") ?? 0;
  const humanSummary = textValue(formData, "human_summary") || name;
  const scheduledStartAt = optionalDateTime(formData, "scheduled_start_at");
  const scheduledEndAt = optionalDateTime(formData, "scheduled_end_at");

  if (!name) throw new Error("reward_rule_name_required");
  if (!families.has(family)) throw new Error("reward_rule_family_invalid");
  if (!metric) throw new Error("reward_rule_metric_required");
  if (!comparators.has(comparator)) throw new Error("reward_rule_comparator_invalid");
  if (!rewardKinds.has(rewardKind)) throw new Error("reward_kind_invalid");
  if (!["all", "any"].includes(operator)) throw new Error("reward_operator_invalid");

  const benefitDefinition: Record<string, unknown> = {
    key: "primary",
    kind: rewardKind,
    delivery: rewardKind === "badge" ? "achievement" : "redeem",
    stackable: boolValue(formData, "stackable"),
  };

  if (rewardKind === "percentage_discount") benefitDefinition.percent = rewardValue;
  if (rewardKind === "fixed_discount")
    benefitDefinition.amount_minor = Math.round(rewardValue * 100);
  if (rewardKind === "credits") benefitDefinition.credits = Math.max(1, Math.round(rewardValue));
  if (rewardKind === "validity_extension")
    benefitDefinition.days = Math.max(1, Math.round(rewardValue));
  if (rewardKind === "surcharge_waiver")
    benefitDefinition.waiver = textValue(formData, "reward_note") || "surcharge";
  if (rewardKind === "special_benefit" || rewardKind === "custom_manual")
    benefitDefinition.label = textValue(formData, "reward_note") || "Beneficio especial";
  if (rewardKind === "badge") benefitDefinition.title = textValue(formData, "reward_note") || name;
  if (validityDays !== null) benefitDefinition.validity_days = validityDays;

  return {
    name,
    description,
    family,
    audienceDefinition: {
      scope: audienceScope,
      only_active_students: true,
    },
    conditionDefinition: {
      operator,
      conditions: [
        {
          key: "primary",
          metric,
          comparator,
          target,
        },
      ],
    },
    evaluationDefinition: {
      allow_historical: boolValue(formData, "allow_historical"),
      grace_days: graceDays,
      attendance_max_one_per_day: boolValue(formData, "attendance_max_one_per_day"),
    },
    cycleDefinition: {
      cadence,
      repeatable: boolValue(formData, "repeatable"),
    },
    rewardDefinition: benefitDefinition,
    presentationDefinition: {
      progress_visible: boolValue(formData, "progress_visible"),
      hidden_until_unlocked: boolValue(formData, "hidden_until_unlocked"),
    },
    communicationDefinition: {
      unlock_notice: boolValue(formData, "unlock_notice"),
      expiring_notice: boolValue(formData, "expiring_notice"),
    },
    incidentDefinition: {
      correction_behavior: "recalculate",
      redeemed_correction_behavior: "incident",
    },
    humanSummary,
    scheduledStartAt,
    scheduledEndAt,
  };
}

function revalidateRewards() {
  revalidatePath("/admin/empresa");
  revalidatePath("/admin/recompensas");
  revalidatePath("/admin/recompensas/reglas");
}

export async function createRewardRuleAction(formData: FormData) {
  let parsed: ReturnType<typeof parseRuleDefinition>;
  try {
    parsed = parseRuleDefinition(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "reward_rule_invalid";
    redirect(`/admin/recompensas/reglas/nueva?error=${encodeURIComponent(message)}`);
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { data, error } = await supabase.rpc("admin_create_reward_rule", {
    p_studio_id: studio.id,
    p_name: parsed.name,
    p_description: parsed.description || null,
    p_family: parsed.family,
    p_audience_definition: parsed.audienceDefinition,
    p_condition_definition: parsed.conditionDefinition,
    p_evaluation_definition: parsed.evaluationDefinition,
    p_cycle_definition: parsed.cycleDefinition,
    p_reward_definition: parsed.rewardDefinition,
    p_presentation_definition: parsed.presentationDefinition,
    p_communication_definition: parsed.communicationDefinition,
    p_incident_definition: parsed.incidentDefinition,
    p_human_summary: parsed.humanSummary,
    p_scheduled_start_at: parsed.scheduledStartAt,
    p_scheduled_end_at: parsed.scheduledEndAt,
  });

  if (error || typeof data !== "string") {
    redirect(
      `/admin/recompensas/reglas/nueva?error=${encodeURIComponent(error?.message ?? "reward_rule_create_failed")}`,
    );
  }

  revalidateRewards();
  redirect(ruleUrl(data, { saved: "created" }));
}

export async function updateRewardRuleAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  if (!ruleId) redirect("/admin/recompensas/reglas?error=reward_rule_required");

  let parsed: ReturnType<typeof parseRuleDefinition>;
  try {
    parsed = parseRuleDefinition(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "reward_rule_invalid";
    redirect(
      `/admin/recompensas/reglas/${encodeURIComponent(ruleId)}/editar?error=${encodeURIComponent(message)}`,
    );
  }

  const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { data, error } = await supabase.rpc("admin_create_reward_rule_version", {
    p_rule_id: ruleId,
    p_name: parsed.name,
    p_description: parsed.description || null,
    p_family: parsed.family,
    p_audience_definition: parsed.audienceDefinition,
    p_condition_definition: parsed.conditionDefinition,
    p_evaluation_definition: parsed.evaluationDefinition,
    p_cycle_definition: parsed.cycleDefinition,
    p_reward_definition: parsed.rewardDefinition,
    p_presentation_definition: parsed.presentationDefinition,
    p_communication_definition: parsed.communicationDefinition,
    p_incident_definition: parsed.incidentDefinition,
    p_human_summary: parsed.humanSummary,
    p_scheduled_start_at: parsed.scheduledStartAt,
    p_scheduled_end_at: parsed.scheduledEndAt,
  });

  if (error || typeof data !== "number") {
    redirect(
      `/admin/recompensas/reglas/${encodeURIComponent(ruleId)}/editar?error=${encodeURIComponent(error?.message ?? "reward_rule_update_failed")}`,
    );
  }

  revalidateRewards();
  revalidatePath(`/admin/recompensas/reglas/${ruleId}`);
  redirect(ruleUrl(ruleId, { saved: "version", version: String(data) }));
}

export async function transitionRewardRuleAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  const action = textValue(formData, "action");
  const note = textValue(formData, "note");

  if (!ruleId || !["schedule", "activate", "pause", "finish", "cancel"].includes(action)) {
    redirect("/admin/recompensas/reglas?error=reward_rule_transition_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { error } = await supabase.rpc("admin_transition_reward_rule", {
    p_rule_id: ruleId,
    p_action: action,
    p_note: note || null,
  });

  if (error) redirect(ruleUrl(ruleId, { error: error.message }));

  revalidateRewards();
  revalidatePath(`/admin/recompensas/reglas/${ruleId}`);
  redirect(ruleUrl(ruleId, { saved: action }));
}

export async function duplicateRewardRuleAction(formData: FormData) {
  const ruleId = textValue(formData, "rule_id");
  if (!ruleId) redirect("/admin/recompensas/reglas?error=reward_rule_required");

  const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { data, error } = await supabase.rpc("admin_duplicate_reward_rule", {
    p_rule_id: ruleId,
  });

  if (error || typeof data !== "string")
    redirect(ruleUrl(ruleId, { error: error?.message ?? "duplicate_failed" }));

  revalidateRewards();
  redirect(ruleUrl(data, { saved: "duplicated" }));
}

export async function grantManualRewardAction(formData: FormData) {
  const studentId = textValue(formData, "student_id");
  const kind = textValue(formData, "kind");
  const value = numberValue(formData, "value", 1);
  const reason = textValue(formData, "reason");
  const validityDays = optionalInteger(formData, "validity_days");

  if (!studentId || !rewardKinds.has(kind) || !reason) {
    redirect(
      `/admin/recompensas/alumnas/${encodeURIComponent(studentId)}?error=manual_reward_invalid`,
    );
  }

  const benefit: Record<string, unknown> = {
    key: "manual",
    kind,
    delivery: "redeem",
    label: textValue(formData, "label") || "Recompensa manual",
  };

  if (kind === "percentage_discount") benefit.percent = value;
  if (kind === "fixed_discount") benefit.amount_minor = Math.round(value * 100);
  if (kind === "credits") benefit.credits = Math.max(1, Math.round(value));
  if (kind === "validity_extension") benefit.days = Math.max(1, Math.round(value));
  if (kind === "surcharge_waiver") benefit.waiver = textValue(formData, "label") || "surcharge";
  if (kind === "special_benefit" || kind === "custom_manual")
    benefit.description = textValue(formData, "label") || "Beneficio especial";

  const { supabase } = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { error } = await supabase.rpc("admin_grant_manual_reward", {
    p_student_id: studentId,
    p_kind: kind,
    p_benefit_definition: benefit,
    p_reason: reason,
    p_validity_days: validityDays,
  });

  if (error) {
    redirect(
      `/admin/recompensas/alumnas/${encodeURIComponent(studentId)}?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/admin/recompensas/alumnas/${studentId}`);
  revalidatePath("/admin/recompensas");
  redirect(`/admin/recompensas/alumnas/${encodeURIComponent(studentId)}?saved=manual_reward`);
}
