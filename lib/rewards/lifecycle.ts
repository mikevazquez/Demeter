export type RewardInstanceStatus =
  | "blocked"
  | "available"
  | "reserved"
  | "redeemed"
  | "expired"
  | "revoked";

export interface RewardLifecycleRpcError {
  message: string;
}

export interface RewardLifecycleRpcResult<T> {
  data: T | null;
  error: RewardLifecycleRpcError | null;
}

export interface RewardLifecycleRpcClient {
  rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardLifecycleRpcResult<T>>;
}

export interface GenerateRewardInstanceInput {
  sourceEvaluationId: string;
  rewardKey: string;
  idempotencyKey: string;
  originSnapshot?: Readonly<Record<string, unknown>>;
  availableFrom?: string | null;
  expiresAt?: string | null;
}

export interface GenerateRewardInstanceResult {
  rewardInstanceId: string;
  status: RewardInstanceStatus;
  created: boolean;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function assertObject(
  value: Readonly<Record<string, unknown>>,
  code: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
}

async function unwrapRpc<T>(
  resultPromise: Promise<RewardLifecycleRpcResult<T>>,
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

interface GenerateRewardInstanceRow {
  reward_instance_id: string;
  status: RewardInstanceStatus;
  created: boolean;
}

export async function generateRewardInstance(
  client: RewardLifecycleRpcClient,
  input: GenerateRewardInstanceInput,
): Promise<GenerateRewardInstanceResult> {
  const originSnapshot = input.originSnapshot ?? {};
  assertObject(originSnapshot, "reward_origin_snapshot_must_be_object");

  const row = await unwrapRpc(
    client.rpc<GenerateRewardInstanceRow>("system_generate_reward_instance", {
      p_source_evaluation_id: requiredText(
        input.sourceEvaluationId,
        "reward_source_evaluation_required",
      ),
      p_reward_key: requiredText(input.rewardKey, "reward_key_required"),
      p_idempotency_key: requiredText(input.idempotencyKey, "reward_idempotency_key_required"),
      p_origin_snapshot: originSnapshot,
      p_available_from: input.availableFrom ?? null,
      p_expires_at: input.expiresAt ?? null,
    }),
    "reward_generation_missing_result",
  );

  return {
    rewardInstanceId: row.reward_instance_id,
    status: row.status,
    created: row.created,
  };
}

export async function makeRewardAvailable(
  client: RewardLifecycleRpcClient,
  rewardInstanceId: string,
): Promise<RewardInstanceStatus> {
  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_make_reward_available", {
      p_reward_instance_id: requiredText(rewardInstanceId, "reward_instance_id_required"),
    }),
    "reward_make_available_missing_result",
  );
}

export async function reserveReward(
  client: RewardLifecycleRpcClient,
  input: {
    rewardInstanceId: string;
    reservationKey: string;
    reservedUntil: string;
    context?: Readonly<Record<string, unknown>>;
  },
): Promise<RewardInstanceStatus> {
  const context = input.context ?? {};
  assertObject(context, "reward_reservation_context_must_be_object");

  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_reserve_reward", {
      p_reward_instance_id: requiredText(
        input.rewardInstanceId,
        "reward_instance_id_required",
      ),
      p_reservation_key: requiredText(input.reservationKey, "reward_reservation_key_required"),
      p_reserved_until: requiredText(input.reservedUntil, "reward_reservation_until_required"),
      p_context: context,
    }),
    "reward_reservation_missing_result",
  );
}

export async function releaseRewardReservation(
  client: RewardLifecycleRpcClient,
  input: {
    rewardInstanceId: string;
    reason: string;
  },
): Promise<RewardInstanceStatus> {
  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_release_reward_reservation", {
      p_reward_instance_id: requiredText(
        input.rewardInstanceId,
        "reward_instance_id_required",
      ),
      p_reason: requiredText(input.reason, "reward_release_reason_required"),
    }),
    "reward_release_missing_result",
  );
}

export async function redeemReward(
  client: RewardLifecycleRpcClient,
  input: {
    rewardInstanceId: string;
    context: Readonly<Record<string, unknown>>;
    allowUnreserved?: boolean;
  },
): Promise<RewardInstanceStatus> {
  assertObject(input.context, "reward_redemption_context_must_be_object");

  if (input.context.partial === true) {
    throw new Error("reward_partial_redemption_not_supported");
  }

  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_redeem_reward", {
      p_reward_instance_id: requiredText(
        input.rewardInstanceId,
        "reward_instance_id_required",
      ),
      p_redemption_context: input.context,
      p_allow_unreserved: input.allowUnreserved ?? false,
    }),
    "reward_redemption_missing_result",
  );
}

export async function markRewardAutoApplied(
  client: RewardLifecycleRpcClient,
  input: {
    rewardInstanceId: string;
    context: Readonly<Record<string, unknown>>;
  },
): Promise<RewardInstanceStatus> {
  assertObject(input.context, "reward_application_context_must_be_object");

  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_mark_reward_auto_applied", {
      p_reward_instance_id: requiredText(
        input.rewardInstanceId,
        "reward_instance_id_required",
      ),
      p_application_context: input.context,
    }),
    "reward_auto_apply_missing_result",
  );
}

export async function expireReward(
  client: RewardLifecycleRpcClient,
  rewardInstanceId: string,
): Promise<RewardInstanceStatus> {
  return unwrapRpc(
    client.rpc<RewardInstanceStatus>("system_expire_reward", {
      p_reward_instance_id: requiredText(rewardInstanceId, "reward_instance_id_required"),
    }),
    "reward_expiration_missing_result",
  );
}
