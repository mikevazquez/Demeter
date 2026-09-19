export type RewardFactValue = string | number | boolean | null;

export type RewardConditionComparator = "eq" | "neq" | "gte" | "lte" | "gt" | "lt";

export interface RewardAtomicCondition {
  key: string;
  metric: string;
  comparator: RewardConditionComparator;
  target: RewardFactValue;
}

export interface RewardConditionDefinition {
  operator: "all" | "any";
  conditions: readonly RewardAtomicCondition[];
}

export interface RewardConditionResult {
  key: string;
  metric: string;
  comparator: RewardConditionComparator;
  target: RewardFactValue;
  current: RewardFactValue;
  passed: boolean;
  missing: boolean;
}

export interface RewardConditionEvaluation {
  fulfilled: boolean;
  conditions: RewardConditionResult[];
  missingMetrics: string[];
}

export interface RewardProgressRpcError {
  message: string;
}

export interface RewardProgressRpcResult<T> {
  data: T | null;
  error: RewardProgressRpcError | null;
}

export interface RewardProgressRpcClient {
  rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardProgressRpcResult<T>>;
}

export interface RelevantRewardRule {
  ruleId: string;
  versionNumber: number;
  family: "loyalty" | "attendance" | "challenge" | "achievement";
  eventType: string;
  metricKey: string;
}

export type RewardProgressEvaluationKind = "event" | "recalculation" | "cycle_close";
export type RewardProgressEvaluationOutcome = "counted" | "ignored" | "recalculated";
export type RewardCycleStatus = "open" | "frozen" | "fulfilled" | "closed_incomplete" | "cancelled";

export interface RecordRewardProgressInput {
  ruleId: string;
  versionNumber: number;
  studentId: string;
  cycleKey: string;
  idempotencyKey: string;
  evaluationKind: RewardProgressEvaluationKind;
  outcome: RewardProgressEvaluationOutcome;
  candidateOccurredAt: string;
  conditionResults: readonly RewardConditionResult[];
  progress: Readonly<Record<string, unknown>>;
  evidence?: Readonly<Record<string, unknown>>;
  eventId?: string | null;
  fulfilled?: boolean;
  reasonCode?: string | null;
  windowStartAt?: string | null;
  windowEndAt?: string | null;
  supersedesEvaluationId?: string | null;
}

export interface RewardProgressRecordResult {
  evaluationId: string;
  participationId: string;
  cycleId: string;
  fulfilled: boolean;
  created: boolean;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function assertFactValue(value: unknown, code: string): asserts value is RewardFactValue {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new Error(code);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(code);
  }
}

export function assertRewardConditionDefinition(
  definition: RewardConditionDefinition,
): void {
  if (definition.operator !== "all" && definition.operator !== "any") {
    throw new Error("reward_condition_operator_invalid");
  }

  if (!Array.isArray(definition.conditions) || definition.conditions.length === 0) {
    throw new Error("reward_condition_requires_conditions");
  }

  const keys = new Set<string>();

  for (const condition of definition.conditions) {
    const key = requiredText(condition.key, "reward_condition_key_required");
    requiredText(condition.metric, "reward_condition_metric_required");

    if (keys.has(key)) {
      throw new Error(`reward_condition_key_duplicate:${key}`);
    }
    keys.add(key);

    if (!["eq", "neq", "gte", "lte", "gt", "lt"].includes(condition.comparator)) {
      throw new Error("reward_condition_comparator_invalid");
    }

    assertFactValue(condition.target, "reward_condition_target_invalid");

    if (
      ["gte", "lte", "gt", "lt"].includes(condition.comparator) &&
      typeof condition.target !== "number"
    ) {
      throw new Error("reward_condition_numeric_target_required");
    }
  }
}

function compareRewardFact(
  current: RewardFactValue,
  target: RewardFactValue,
  comparator: RewardConditionComparator,
): boolean {
  if (comparator === "eq") return current === target;
  if (comparator === "neq") return current !== target;

  if (typeof current !== "number" || typeof target !== "number") {
    return false;
  }

  if (comparator === "gte") return current >= target;
  if (comparator === "lte") return current <= target;
  if (comparator === "gt") return current > target;
  return current < target;
}

export function evaluateRewardConditions(
  definition: RewardConditionDefinition,
  facts: Readonly<Record<string, RewardFactValue | undefined>>,
): RewardConditionEvaluation {
  assertRewardConditionDefinition(definition);

  const conditions = definition.conditions.map((condition) => {
    const rawCurrent = facts[condition.metric];
    const missing = rawCurrent === undefined;
    const current = missing ? null : rawCurrent;

    if (!missing) {
      assertFactValue(current, `reward_fact_invalid:${condition.metric}`);
    }

    return {
      key: condition.key,
      metric: condition.metric,
      comparator: condition.comparator,
      target: condition.target,
      current,
      passed: !missing && compareRewardFact(current, condition.target, condition.comparator),
      missing,
    } satisfies RewardConditionResult;
  });

  const fulfilled =
    definition.operator === "all"
      ? conditions.every((condition) => condition.passed)
      : conditions.some((condition) => condition.passed);

  return {
    fulfilled,
    conditions,
    missingMetrics: conditions
      .filter((condition) => condition.missing)
      .map((condition) => condition.metric),
  };
}

async function unwrapRpc<T>(
  resultPromise: Promise<RewardProgressRpcResult<T>>,
  emptyCode: string,
): Promise<T> {
  const result = await resultPromise;

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error(emptyCode);
  }

  return result.data;
}

export async function registerRewardRuleEventBinding(
  client: RewardProgressRpcClient,
  input: {
    ruleId: string;
    versionNumber: number;
    eventType: string;
    metricKey: string;
  },
): Promise<string> {
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("reward_binding_version_invalid");
  }

  return unwrapRpc(
    client.rpc<string>("system_register_reward_rule_event_binding", {
      p_rule_id: requiredText(input.ruleId, "reward_binding_rule_required"),
      p_version_number: input.versionNumber,
      p_event_type: requiredText(input.eventType, "reward_binding_event_type_required"),
      p_metric_key: requiredText(input.metricKey, "reward_binding_metric_key_required"),
    }),
    "reward_binding_missing_id",
  );
}

interface RelevantRewardRuleRow {
  rule_id: string;
  version_number: number;
  family: RelevantRewardRule["family"];
  event_type: string;
  metric_key: string;
}

export async function getRelevantRewardRulesForEvent(
  client: RewardProgressRpcClient,
  eventId: string,
): Promise<RelevantRewardRule[]> {
  const rows = await unwrapRpc(
    client.rpc<RelevantRewardRuleRow[]>("reward_rules_for_domain_event", {
      p_event_id: requiredText(eventId, "reward_progress_event_required"),
    }),
    "reward_progress_rules_missing_result",
  );

  return rows.map((row) => ({
    ruleId: row.rule_id,
    versionNumber: row.version_number,
    family: row.family,
    eventType: row.event_type,
    metricKey: row.metric_key,
  }));
}

interface RewardProgressRecordRow {
  evaluation_id: string;
  participation_id: string;
  cycle_id: string;
  fulfilled: boolean;
  created: boolean;
}

export async function recordRewardProgressEvaluation(
  client: RewardProgressRpcClient,
  input: RecordRewardProgressInput,
): Promise<RewardProgressRecordResult> {
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("reward_progress_version_invalid");
  }

  if (input.outcome === "ignored" && !input.reasonCode?.trim()) {
    throw new Error("reward_progress_ignored_reason_required");
  }

  const row = await unwrapRpc(
    client.rpc<RewardProgressRecordRow>("system_record_reward_progress_evaluation", {
      p_rule_id: requiredText(input.ruleId, "reward_progress_rule_required"),
      p_version_number: input.versionNumber,
      p_student_id: requiredText(input.studentId, "reward_progress_student_required"),
      p_cycle_key: requiredText(input.cycleKey, "reward_progress_cycle_key_required"),
      p_idempotency_key: requiredText(
        input.idempotencyKey,
        "reward_progress_idempotency_key_required",
      ),
      p_evaluation_kind: input.evaluationKind,
      p_outcome: input.outcome,
      p_candidate_occurred_at: requiredText(
        input.candidateOccurredAt,
        "reward_progress_candidate_time_required",
      ),
      p_condition_results: input.conditionResults,
      p_progress: input.progress,
      p_evidence: input.evidence ?? {},
      p_event_id: input.eventId ?? null,
      p_fulfilled: input.fulfilled ?? false,
      p_reason_code: input.reasonCode?.trim() || null,
      p_window_start_at: input.windowStartAt ?? null,
      p_window_end_at: input.windowEndAt ?? null,
      p_supersedes_evaluation_id: input.supersedesEvaluationId ?? null,
    }),
    "reward_progress_record_missing_result",
  );

  return {
    evaluationId: row.evaluation_id,
    participationId: row.participation_id,
    cycleId: row.cycle_id,
    fulfilled: row.fulfilled,
    created: row.created,
  };
}

export async function transitionRewardCycle(
  client: RewardProgressRpcClient,
  input: {
    cycleId: string;
    action: "freeze" | "resume" | "close_incomplete" | "cancel";
    reason?: string | null;
  },
): Promise<RewardCycleStatus> {
  return unwrapRpc(
    client.rpc<RewardCycleStatus>("system_transition_reward_cycle", {
      p_cycle_id: requiredText(input.cycleId, "reward_cycle_id_required"),
      p_action: input.action,
      p_reason: input.reason?.trim() || null,
    }),
    "reward_cycle_transition_missing_result",
  );
}
