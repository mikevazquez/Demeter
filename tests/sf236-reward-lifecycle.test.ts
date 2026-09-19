import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  expireReward,
  generateRewardInstance,
  markRewardAutoApplied,
  redeemReward,
  releaseRewardReservation,
  reserveReward,
  type RewardLifecycleRpcClient,
  type RewardLifecycleRpcResult,
} from "../lib/rewards/lifecycle";

class FakeRewardLifecycleRpcClient implements RewardLifecycleRpcClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardLifecycleRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_generate_reward_instance") {
      return {
        data: {
          reward_instance_id: "reward-1",
          status: "available",
          created: true,
        } as T,
        error: null,
      };
    }

    if (functionName === "system_reserve_reward") {
      return { data: "reserved" as T, error: null };
    }

    if (functionName === "system_release_reward_reservation") {
      return { data: "available" as T, error: null };
    }

    if (functionName === "system_redeem_reward") {
      return { data: "redeemed" as T, error: null };
    }

    if (functionName === "system_mark_reward_auto_applied") {
      return { data: "redeemed" as T, error: null };
    }

    if (functionName === "system_expire_reward") {
      return { data: "expired" as T, error: null };
    }

    return { data: null, error: { message: `unexpected_rpc:${functionName}` } };
  }
}

describe("SF-236 reward lifecycle", () => {
  it("generates a frozen reward instance from a fulfilled progress evaluation", async () => {
    const client = new FakeRewardLifecycleRpcClient();

    await expect(
      generateRewardInstance(client, {
        sourceEvaluationId: "evaluation-1",
        rewardKey: "month-6",
        idempotencyKey: "reward:rule-1:cycle-1:month-6",
        originSnapshot: { reason: "6 meses consecutivos" },
      }),
    ).resolves.toEqual({
      rewardInstanceId: "reward-1",
      status: "available",
      created: true,
    });

    expect(client.calls[0]?.args).toMatchObject({
      p_source_evaluation_id: "evaluation-1",
      p_reward_key: "month-6",
      p_idempotency_key: "reward:rule-1:cycle-1:month-6",
    });
  });

  it("reserves and releases without consuming the reward", async () => {
    const client = new FakeRewardLifecycleRpcClient();

    await expect(
      reserveReward(client, {
        rewardInstanceId: "reward-1",
        reservationKey: "checkout-1",
        reservedUntil: "2026-09-19T21:00:00.000Z",
      }),
    ).resolves.toBe("reserved");

    await expect(
      releaseRewardReservation(client, {
        rewardInstanceId: "reward-1",
        reason: "checkout_cancelled",
      }),
    ).resolves.toBe("available");
  });

  it("rejects partial redemption before calling the database", async () => {
    const client = new FakeRewardLifecycleRpcClient();

    await expect(
      redeemReward(client, {
        rewardInstanceId: "reward-1",
        context: { partial: true },
      }),
    ).rejects.toThrow("reward_partial_redemption_not_supported");

    expect(client.calls).toHaveLength(0);
  });

  it("supports completed redemption, automatic application and expiration", async () => {
    const client = new FakeRewardLifecycleRpcClient();

    await expect(
      redeemReward(client, {
        rewardInstanceId: "reward-1",
        context: { sale_id: "sale-1", actual_savings_minor: 15000 },
      }),
    ).resolves.toBe("redeemed");

    await expect(
      markRewardAutoApplied(client, {
        rewardInstanceId: "reward-2",
        context: { credit_delta: 1 },
      }),
    ).resolves.toBe("redeemed");

    await expect(expireReward(client, "reward-3")).resolves.toBe("expired");
  });

  it("locks grant limits, reservation tolerance and immutable redemption semantics", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919210000_sf236_reward_lifecycle.sql"),
      "utf8",
    );

    expect(sql).toContain("reward_instances_cycle_reward_key_unique");
    expect(sql).toContain("source_evaluation_id");
    expect(sql).toContain("reward_source_not_fulfilled");
    expect(sql).toContain("max_per_student_total");
    expect(sql).toContain("cooldown_days");
    expect(sql).toContain("reward_grant_limit_reached");
    expect(sql).toContain("reward_grant_cooldown_active");
    expect(sql).toContain("reward_partial_redemption_not_supported");
    expect(sql).toContain("v_reward.reserved_until >= v_now");
    expect(sql).toContain("if v_reward.status = 'redeemed' then");
    expect(sql).toContain("system_mark_reward_auto_applied");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("status = 'available', redeemed_at = null");
  });
});
