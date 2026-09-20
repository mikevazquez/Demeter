import {
  evaluateRewardConditions,
  recordRewardProgressEvaluation,
  type RewardConditionDefinition,
  type RewardFactValue,
  type RewardProgressEvaluationKind,
  type RewardProgressRecordResult,
  type RewardProgressRpcClient,
} from "./progress";

export interface RewardLoyaltyPeriod {
  acquisition_id: string;
  product_template_id?: string;
  product_name?: string;
  product_type?: string;
  sale_id?: string | null;
  sale_line_id?: string | null;
  starts_on?: string;
  effective_start?: string;
  expires_on?: string;
  net_paid_minor?: number;
  gap_days?: number;
  streak_after_period?: number;
  reason_code?: string;
  discount_kind?: string | null;
}

export interface RewardLoyaltyState {
  ruleId: string;
  versionNumber: number;
  studentId: string;
  asOfDate: string;
  eligibilityStartDate: string | null;
  graceDays: number;
  allowHistorical: boolean;
  countZeroValuePeriods: boolean;
  countUnpaidPeriods: boolean;
  currentConsecutivePeriods: number;
  totalPaidPeriods: number;
  bestConsecutivePeriods: number;
  currentCoverageStart: string | null;
  currentCoverageEnd: string | null;
  activeCoverage: boolean;
  inGrace: boolean;
  effectiveDaysSinceCoverage: number;
  countedPeriods: RewardLoyaltyPeriod[];
  excludedPeriods: RewardLoyaltyPeriod[];
}

interface RewardLoyaltyStateRow {
  rule_id: string;
  version_number: number;
  student_id: string;
  as_of_date: string;
  eligibility_start_date: string | null;
  grace_days: number;
  allow_historical: boolean;
  count_zero_value_periods: boolean;
  count_unpaid_periods: boolean;
  current_consecutive_periods: number;
  total_paid_periods: number;
  best_consecutive_periods: number;
  current_coverage_start: string | null;
  current_coverage_end: string | null;
  active_coverage: boolean;
  in_grace: boolean;
  effective_days_since_coverage: number;
  counted_periods: RewardLoyaltyPeriod[];
  excluded_periods: RewardLoyaltyPeriod[];
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

async function unwrapRpc<T>(
  resultPromise: ReturnType<RewardProgressRpcClient["rpc"]> & Promise<{ data: T | null }>,
  emptyCode: string,
): Promise<T> {
  const result = await resultPromise;

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error(emptyCode);
  }

  return result.data as T;
}

export function loyaltyCycleKey(versionNumber: number): string {
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new Error("reward_loyalty_version_invalid");
  }

  return `loyalty:v${versionNumber}`;
}

export async function getRewardLoyaltyState(
  client: RewardProgressRpcClient,
  input: {
    ruleId: string;
    versionNumber: number;
    studentId: string;
    asOfDate?: string | null;
  },
): Promise<RewardLoyaltyState> {
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("reward_loyalty_version_invalid");
  }

  const row = await unwrapRpc<RewardLoyaltyStateRow>(
    client.rpc<RewardLoyaltyStateRow>("system_compute_reward_loyalty_state", {
      p_rule_id: requiredText(input.ruleId, "reward_loyalty_rule_required"),
      p_version_number: input.versionNumber,
      p_student_id: requiredText(input.studentId, "reward_loyalty_student_required"),
      p_as_of_date: input.asOfDate ?? null,
    }),
    "reward_loyalty_state_missing_result",
  );

  return {
    ruleId: row.rule_id,
    versionNumber: row.version_number,
    studentId: row.student_id,
    asOfDate: row.as_of_date,
    eligibilityStartDate: row.eligibility_start_date,
    graceDays: row.grace_days,
    allowHistorical: row.allow_historical,
    countZeroValuePeriods: row.count_zero_value_periods,
    countUnpaidPeriods: row.count_unpaid_periods,
    currentConsecutivePeriods: row.current_consecutive_periods,
    totalPaidPeriods: row.total_paid_periods,
    bestConsecutivePeriods: row.best_consecutive_periods,
    currentCoverageStart: row.current_coverage_start,
    currentCoverageEnd: row.current_coverage_end,
    activeCoverage: row.active_coverage,
    inGrace: row.in_grace,
    effectiveDaysSinceCoverage: row.effective_days_since_coverage,
    countedPeriods: row.counted_periods ?? [],
    excludedPeriods: row.excluded_periods ?? [],
  };
}

export function loyaltyProgressMetrics(
  state: RewardLoyaltyState,
): Readonly<Record<string, RewardFactValue>> {
  return {
    "loyalty.current_consecutive_periods": state.currentConsecutivePeriods,
    "loyalty.total_paid_periods": state.totalPaidPeriods,
    "loyalty.best_consecutive_periods": state.bestConsecutivePeriods,
    "loyalty.active_coverage": state.activeCoverage,
    "loyalty.in_grace": state.inGrace,
  };
}

export async function evaluateAndRecordLoyaltyProgress(
  client: RewardProgressRpcClient,
  input: {
    ruleId: string;
    versionNumber: number;
    studentId: string;
    conditionDefinition: RewardConditionDefinition;
    candidateOccurredAt: string;
    idempotencyKey: string;
    evaluationKind?: RewardProgressEvaluationKind;
    asOfDate?: string | null;
    eventId?: string | null;
  },
): Promise<{
  state: RewardLoyaltyState;
  progress: RewardProgressRecordResult;
}> {
  const state = await getRewardLoyaltyState(client, {
    ruleId: input.ruleId,
    versionNumber: input.versionNumber,
    studentId: input.studentId,
    asOfDate: input.asOfDate,
  });
  const metrics = loyaltyProgressMetrics(state);
  const evaluation = evaluateRewardConditions(input.conditionDefinition, metrics);

  const progress = await recordRewardProgressEvaluation(client, {
    ruleId: input.ruleId,
    versionNumber: input.versionNumber,
    studentId: input.studentId,
    cycleKey: loyaltyCycleKey(input.versionNumber),
    idempotencyKey: input.idempotencyKey,
    evaluationKind: input.evaluationKind ?? "recalculation",
    outcome: input.evaluationKind === "event" ? "counted" : "recalculated",
    candidateOccurredAt: input.candidateOccurredAt,
    conditionResults: evaluation.conditions,
    progress: metrics,
    evidence: {
      source: "operational_acquisitions_sales_payments",
      as_of_date: state.asOfDate,
      counted_periods: state.countedPeriods,
      excluded_periods: state.excludedPeriods,
    },
    eventId: input.eventId ?? null,
    fulfilled: evaluation.fulfilled,
  });

  return { state, progress };
}
