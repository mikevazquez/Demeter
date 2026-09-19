import type { RewardProgressRpcClient } from "./progress";

export interface RewardCorrectionReconciliation {
  evaluationId: string;
  previousFulfilled: boolean;
  nowFulfilled: boolean;
  grantRequired: boolean;
  revoked: number;
  reviewIncidents: number;
  criticalIncidents: number;
  unchanged: number;
}

interface RewardCorrectionReconciliationRow {
  evaluation_id: string;
  previous_fulfilled: boolean;
  now_fulfilled: boolean;
  grant_required: boolean;
  revoked: number;
  review_incidents: number;
  critical_incidents: number;
  unchanged: number;
}

export interface RewardIncidentResolution {
  incidentId: string;
  status: string;
  rewardStatus: string | null;
}

interface RewardIncidentResolutionRow {
  incident_id: string;
  status: string;
  reward_status: string | null;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

async function unwrapRpc<T>(
  resultPromise: Promise<{ data: T | null; error: { message: string } | null }>,
  emptyCode: string,
): Promise<T> {
  const result = await resultPromise;
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error(emptyCode);
  return result.data;
}

export async function reconcileRewardCorrection(
  client: RewardProgressRpcClient,
  newEvaluationId: string,
): Promise<RewardCorrectionReconciliation> {
  const row = await unwrapRpc(
    client.rpc<RewardCorrectionReconciliationRow>("system_reconcile_reward_correction", {
      p_new_evaluation_id: requiredText(
        newEvaluationId,
        "reward_correction_evaluation_required",
      ),
    }),
    "reward_correction_reconciliation_missing_result",
  );

  return {
    evaluationId: row.evaluation_id,
    previousFulfilled: row.previous_fulfilled,
    nowFulfilled: row.now_fulfilled,
    grantRequired: row.grant_required,
    revoked: row.revoked,
    reviewIncidents: row.review_incidents,
    criticalIncidents: row.critical_incidents,
    unchanged: row.unchanged,
  };
}

export async function requestRewardReview(
  client: RewardProgressRpcClient,
  input: {
    rewardInstanceId: string;
    reason: string;
  },
): Promise<string> {
  return unwrapRpc(
    client.rpc<string>("admin_request_reward_review", {
      p_reward_instance_id: requiredText(
        input.rewardInstanceId,
        "reward_instance_id_required",
      ),
      p_reason: requiredText(input.reason, "reward_incident_reason_required"),
    }),
    "reward_incident_request_missing_result",
  );
}

export async function resolveRewardIncident(
  client: RewardProgressRpcClient,
  input: {
    incidentId: string;
    action:
      | "mark_review"
      | "revoke_reward"
      | "keep_exception"
      | "close_no_action"
      | "close";
    reason: string;
    details?: Readonly<Record<string, unknown>>;
  },
): Promise<RewardIncidentResolution> {
  const details = input.details ?? {};
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    throw new Error("reward_incident_resolution_must_be_object");
  }

  const row = await unwrapRpc(
    client.rpc<RewardIncidentResolutionRow>("admin_resolve_reward_incident", {
      p_incident_id: requiredText(input.incidentId, "reward_incident_id_required"),
      p_action: input.action,
      p_reason: requiredText(input.reason, "reward_incident_reason_required"),
      p_resolution_details: details,
    }),
    "reward_incident_resolution_missing_result",
  );

  return {
    incidentId: row.incident_id,
    status: row.status,
    rewardStatus: row.reward_status,
  };
}
