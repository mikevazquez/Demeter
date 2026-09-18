import type { AutomationCatalogCode } from "./catalog";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
  AutomationInstanceStatus,
} from "./instances";

export type AutomationEligibilityPhase = "initial" | "revalidation";
export type AutomationEligibilityOutcome = "proceed" | "skip" | "cancel";
export type AutomationEligibilityConditionKind = "protected" | "optional";

export interface AutomationEligibilityCondition {
  key: string;
  kind: AutomationEligibilityConditionKind;
  applies: boolean;
  passed: boolean;
  reasonCode: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface AutomationEligibilityInstanceSnapshot {
  id: string;
  studioId: string;
  catalogCode: AutomationCatalogCode;
  status: AutomationInstanceStatus;
  currentVersionNumber: number;
  eligibleFrom: string | null;
}

export interface AutomationEligibilityCandidate {
  key: string;
  occurredAt: string;
  versionNumber: number;
  eventId?: string;
  subjectEntityType?: string;
  subjectEntityId?: string;
}

export interface AutomationEligibilityDecision {
  eligible: boolean;
  phase: AutomationEligibilityPhase;
  outcome: AutomationEligibilityOutcome;
  conditions: readonly AutomationEligibilityCondition[];
  exclusionReasons: readonly {
    conditionKey: string;
    reasonCode: string;
    reason: string;
  }[];
}

export interface PersistedAutomationEligibilityDecision {
  evaluationId: string;
  eligible: boolean;
  outcome: AutomationEligibilityOutcome;
  exclusionReasons: readonly {
    conditionKey: string;
    reasonCode: string;
    reason: string;
  }[];
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`automation_eligibility_invalid_timestamp:${field}`);
  }

  return timestamp;
}

function assertCondition(condition: AutomationEligibilityCondition): void {
  if (!condition.key.trim()) {
    throw new Error("automation_eligibility_condition_key_required");
  }

  if (!condition.reasonCode.trim()) {
    throw new Error("automation_eligibility_reason_code_required");
  }

  if (!condition.reason.trim()) {
    throw new Error("automation_eligibility_reason_required");
  }

  if (condition.kind === "protected" && !condition.applies) {
    throw new Error("automation_eligibility_protected_condition_must_apply");
  }
}

function systemConditions(
  instance: AutomationEligibilityInstanceSnapshot,
  candidate: AutomationEligibilityCandidate,
): AutomationEligibilityCondition[] {
  const candidateOccurredAt = parseTimestamp(candidate.occurredAt, "candidate.occurredAt");
  const eligibleFrom = instance.eligibleFrom
    ? parseTimestamp(instance.eligibleFrom, "instance.eligibleFrom")
    : null;

  return [
    {
      key: "instance.active",
      kind: "protected",
      applies: true,
      passed: instance.status === "active",
      reasonCode: "instance_not_active",
      reason: "La automatización ya no está activa.",
      evidence: { status: instance.status },
    },
    {
      key: "instance.version_current",
      kind: "protected",
      applies: true,
      passed: candidate.versionNumber === instance.currentVersionNumber,
      reasonCode: "configuration_version_changed",
      reason: "La configuración cambió después de crear el candidato.",
      evidence: {
        candidateVersionNumber: candidate.versionNumber,
        currentVersionNumber: instance.currentVersionNumber,
      },
    },
    {
      key: "instance.temporal_boundary",
      kind: "protected",
      applies: true,
      passed: eligibleFrom !== null && candidateOccurredAt >= eligibleFrom,
      reasonCode: "candidate_before_eligible_from",
      reason: "El candidato pertenece a un periodo anterior a la activación/configuración vigente.",
      evidence: {
        candidateOccurredAt: candidate.occurredAt,
        eligibleFrom: instance.eligibleFrom,
      },
    },
  ];
}

export function evaluateAutomationEligibility(input: {
  instance: AutomationEligibilityInstanceSnapshot;
  candidate: AutomationEligibilityCandidate;
  phase: AutomationEligibilityPhase;
  conditions?: readonly AutomationEligibilityCondition[];
}): AutomationEligibilityDecision {
  if (input.candidate.versionNumber < 1 || !Number.isInteger(input.candidate.versionNumber)) {
    throw new Error("automation_eligibility_version_invalid");
  }

  if (!input.candidate.key.trim()) {
    throw new Error("automation_eligibility_candidate_key_required");
  }

  const domainConditions = [...(input.conditions ?? [])];

  for (const condition of domainConditions) {
    assertCondition(condition);
  }

  const conditions = [...systemConditions(input.instance, input.candidate), ...domainConditions];
  const failed = conditions.filter((condition) => condition.applies && !condition.passed);

  const exclusionReasons = failed.map((condition) => ({
    conditionKey: condition.key,
    reasonCode: condition.reasonCode,
    reason: condition.reason,
  }));

  const eligible = failed.length === 0;
  const outcome: AutomationEligibilityOutcome = eligible
    ? "proceed"
    : input.phase === "revalidation"
      ? "cancel"
      : "skip";

  return {
    eligible,
    phase: input.phase,
    outcome,
    conditions,
    exclusionReasons,
  };
}

function toRpcConditions(
  conditions: readonly AutomationEligibilityCondition[],
): readonly Record<string, unknown>[] {
  return conditions.map((condition) => {
    assertCondition(condition);

    return {
      key: condition.key,
      kind: condition.kind,
      applies: condition.applies,
      passed: condition.passed,
      reason_code: condition.reasonCode,
      reason: condition.reason,
      ...(condition.evidence ? { evidence: condition.evidence } : {}),
    };
  });
}

function unwrapEligibilityRpc(
  result: AutomationInstanceRpcResult<{
    evaluation_id: string;
    eligible: boolean;
    outcome: AutomationEligibilityOutcome;
    exclusion_reasons: Array<{
      condition_key: string;
      reason_code: string;
      reason: string;
    }>;
  }>,
): PersistedAutomationEligibilityDecision {
  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    throw new Error("automation_eligibility_rpc_empty_result");
  }

  return {
    evaluationId: result.data.evaluation_id,
    eligible: result.data.eligible,
    outcome: result.data.outcome,
    exclusionReasons: result.data.exclusion_reasons.map((reason) => ({
      conditionKey: reason.condition_key,
      reasonCode: reason.reason_code,
      reason: reason.reason,
    })),
  };
}

export async function recordAutomationEligibilityEvaluation(
  client: AutomationInstanceRpcClient,
  input: {
    instanceId: string;
    versionNumber: number;
    candidateKey: string;
    candidateOccurredAt: string;
    phase: AutomationEligibilityPhase;
    conditions?: readonly AutomationEligibilityCondition[];
    eventId?: string;
    subjectEntityType?: string;
    subjectEntityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PersistedAutomationEligibilityDecision> {
  parseTimestamp(input.candidateOccurredAt, "candidate.occurredAt");

  if (!input.candidateKey.trim()) {
    throw new Error("automation_eligibility_candidate_key_required");
  }

  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("automation_eligibility_version_invalid");
  }

  const result = await client.rpc<{
    evaluation_id: string;
    eligible: boolean;
    outcome: AutomationEligibilityOutcome;
    exclusion_reasons: Array<{
      condition_key: string;
      reason_code: string;
      reason: string;
    }>;
  }>("record_automation_eligibility_evaluation", {
    p_instance_id: input.instanceId,
    p_version_number: input.versionNumber,
    p_candidate_key: input.candidateKey.trim(),
    p_candidate_occurred_at: input.candidateOccurredAt,
    p_phase: input.phase,
    p_conditions: toRpcConditions(input.conditions ?? []),
    p_event_id: input.eventId ?? null,
    p_subject_entity_type: input.subjectEntityType ?? null,
    p_subject_entity_id: input.subjectEntityId ?? null,
    p_metadata: input.metadata ?? {},
  });

  return unwrapEligibilityRpc(result);
}
