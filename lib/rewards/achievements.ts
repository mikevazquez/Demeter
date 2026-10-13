import type { RewardProgressRpcClient } from "./progress";

export interface RewardAchievementUnlockResult {
  achievementUnlockId: string;
  created: boolean;
  unlockedAt: string;
}

interface RewardAchievementUnlockRow {
  achievement_unlock_id: string;
  created: boolean;
  unlocked_at: string;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export async function unlockRewardAchievement(
  client: RewardProgressRpcClient,
  input: {
    sourceEvaluationId: string;
    achievementKey: string;
    title: string;
    badgeSnapshot?: Readonly<Record<string, unknown>>;
    levelKey?: string | null;
    idempotencyKey?: string | null;
    unlockedAt?: string | null;
  },
): Promise<RewardAchievementUnlockResult> {
  const badgeSnapshot = input.badgeSnapshot ?? {};

  if (typeof badgeSnapshot !== "object" || badgeSnapshot === null || Array.isArray(badgeSnapshot)) {
    throw new Error("reward_achievement_badge_must_be_object");
  }

  const result = await client.rpc<RewardAchievementUnlockRow>("system_unlock_reward_achievement", {
    p_source_evaluation_id: requiredText(
      input.sourceEvaluationId,
      "reward_achievement_source_evaluation_required",
    ),
    p_achievement_key: requiredText(input.achievementKey, "reward_achievement_key_required"),
    p_title_snapshot: requiredText(input.title, "reward_achievement_title_required"),
    p_badge_snapshot: badgeSnapshot,
    p_level_key: input.levelKey?.trim() || null,
    p_idempotency_key: input.idempotencyKey?.trim() || null,
    p_unlocked_at: input.unlockedAt ?? null,
  });

  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("reward_achievement_unlock_missing_result");

  return {
    achievementUnlockId: result.data.achievement_unlock_id,
    created: result.data.created,
    unlockedAt: result.data.unlocked_at,
  };
}
