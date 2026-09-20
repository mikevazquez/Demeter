import { describe, expect, it } from "vitest";

import {
  buildRewardMessagingInput,
  groupRewardCommunications,
  prepareRewardCommunication,
  REWARD_UNLOCK_SOURCE_EVENT,
} from "../lib/rewards/communications";

const baseFact = {
  key: "reward-1",
  studentId: "student-1",
  occurredAt: "2026-09-20T02:30:00.000Z",
  ruleId: "rule-1",
  rewardInstanceId: "instance-1",
};

describe("SF-244 Rewards communications", () => {
  it("uses the existing unlocked reward event as the internal source contract", () => {
    expect(REWARD_UNLOCK_SOURCE_EVENT).toBe("reward_instance_events:unlocked");
  });

  it("keeps unlock and expiry notices compatible with the existing rule defaults", () => {
    const unlocked = prepareRewardCommunication({
      fact: { ...baseFact, kind: "unlocked", title: "Clase gratis" },
      definition: {},
    });
    const expiring = prepareRewardCommunication({
      fact: { ...baseFact, key: "reward-2", kind: "expiring" },
      definition: {},
    });

    expect(unlocked.enabled).toBe(true);
    expect(expiring.enabled).toBe(true);
    expect(unlocked.resolution.decision).toBe("send");
    expect(expiring.resolution.decision).toBe("send");
  });

  it("requires explicit configuration for near-progress and streak-reset notices", () => {
    const nearDisabled = prepareRewardCommunication({
      fact: { ...baseFact, kind: "near_progress" },
      definition: {},
    });
    const nearEnabled = prepareRewardCommunication({
      fact: { ...baseFact, kind: "near_progress" },
      definition: { near_progress_notice: true },
    });
    const streakEnabled = prepareRewardCommunication({
      fact: { ...baseFact, kind: "streak_reset" },
      definition: { streak_reset_notice: true },
    });

    expect(nearDisabled.resolution.decision).toBe("suppress");
    expect(nearEnabled.resolution.decision).toBe("send");
    expect(streakEnabled.resolution.decision).toBe("send");
    expect(streakEnabled.message.toLowerCase()).not.toContain("perdiste");
    expect(streakEnabled.message.toLowerCase()).not.toContain("fallaste");
    expect(streakEnabled.message).toContain("Cada clase cuenta");
  });

  it("respects SF-168 communication preferences before any provider is involved", () => {
    const blocked = prepareRewardCommunication({
      fact: { ...baseFact, kind: "unlocked" },
      definition: { unlock_notice: true },
      preferences: {
        operational: true,
        reminders: true,
        retention: false,
        promotions: true,
        whatsappBlocked: false,
      },
    });

    expect(blocked.resolution.decision).toBe("suppress");
    expect(blocked.resolution.reasonCode).toBe("person_category_opt_out");
  });

  it("groups multiple notices only when the caller supplies the same frequency key", () => {
    const a = prepareRewardCommunication({
      fact: { ...baseFact, kind: "unlocked", frequencyKey: "daily:2026-09-20" },
    });
    const b = prepareRewardCommunication({
      fact: {
        ...baseFact,
        key: "reward-2",
        rewardInstanceId: "instance-2",
        kind: "expiring",
        frequencyKey: "daily:2026-09-20",
      },
    });
    const c = prepareRewardCommunication({
      fact: {
        ...baseFact,
        key: "reward-3",
        rewardInstanceId: "instance-3",
        kind: "unlocked",
      },
    });

    const batches = groupRewardCommunications([a, b, c]);

    expect(batches).toHaveLength(2);
    expect(batches.find((batch) => batch.frequencyKey === "daily:2026-09-20")?.items).toHaveLength(
      2,
    );
  });

  it("builds an SF-173 compatible input without delivering or consuming the reward", () => {
    const communication = prepareRewardCommunication({
      fact: { ...baseFact, kind: "unlocked", title: "Clase gratis" },
    });

    expect(
      buildRewardMessagingInput({
        communication,
        executionId: "execution-1",
        eligibilityEvaluationId: "evaluation-1",
        recipient: "+5213312345678",
      }),
    ).toEqual({
      executionId: "execution-1",
      eligibilityEvaluationId: "evaluation-1",
      recipient: "+5213312345678",
      template: "reward_unlocked",
      variables: expect.objectContaining({
        reward_communication_kind: "unlocked",
        reward_instance_id: "instance-1",
        reward_title: "Clase gratis",
      }),
      metadata: expect.objectContaining({
        source: "rewards",
        reward_communication_kind: "unlocked",
      }),
    });
  });

  it("does not build a provider input for suppressed or deferred notices", () => {
    const communication = prepareRewardCommunication({
      fact: { ...baseFact, kind: "near_progress" },
      definition: {},
    });

    expect(() =>
      buildRewardMessagingInput({
        communication,
        executionId: "execution-1",
        eligibilityEvaluationId: "evaluation-1",
        recipient: "+5213312345678",
      }),
    ).toThrow("reward_communication_not_ready_for_delivery");
  });
});
