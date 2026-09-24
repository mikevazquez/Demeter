import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateRewardConditions,
  getRelevantRewardRulesForEvent,
  recordRewardProgressEvaluation,
  transitionRewardCycle,
  type RewardProgressRpcClient,
  type RewardProgressRpcResult,
} from "../lib/rewards/progress";

class FakeRewardProgressRpcClient implements RewardProgressRpcClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardProgressRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "reward_rules_for_domain_event") {
      return {
        data: [
          {
            rule_id: "rule-1",
            version_number: 2,
            family: "attendance",
            event_type: "attendance.marked",
            metric_key: "attendance.count",
          },
          {
            rule_id: "rule-2",
            version_number: 1,
            family: "challenge",
            event_type: "attendance.marked",
            metric_key: "disciplines.count",
          },
        ] as T,
        error: null,
      };
    }

    if (functionName === "system_record_reward_progress_evaluation") {
      return {
        data: {
          evaluation_id: "evaluation-1",
          participation_id: "participation-1",
          cycle_id: "cycle-1",
          fulfilled: args.p_fulfilled,
          created: true,
        } as T,
        error: null,
      };
    }

    if (functionName === "system_transition_reward_cycle") {
      return { data: "frozen" as T, error: null };
    }

    return { data: null, error: { message: `unexpected_rpc:${functionName}` } };
  }
}

describe("SF-235 rewards progress", () => {
  it("evaluates ALL conditions and explains missing facts", () => {
    const result = evaluateRewardConditions(
      {
        operator: "all",
        conditions: [
          { key: "attendance", metric: "attendance.count", comparator: "gte", target: 4 },
          { key: "days", metric: "attendance.distinct_days", comparator: "gte", target: 3 },
        ],
      },
      { "attendance.count": 4 },
    );

    expect(result.fulfilled).toBe(false);
    expect(result.conditions.map((condition) => condition.passed)).toEqual([true, false]);
    expect(result.missingMetrics).toEqual(["attendance.distinct_days"]);
  });

  it("supports ANY and rejects invalid numeric targets", () => {
    expect(
      evaluateRewardConditions(
        {
          operator: "any",
          conditions: [
            { key: "pole", metric: "pole.count", comparator: "gte", target: 3 },
            { key: "aerial", metric: "aerial.count", comparator: "gte", target: 3 },
          ],
        },
        { "pole.count": 1, "aerial.count": 3 },
      ).fulfilled,
    ).toBe(true);

    expect(() =>
      evaluateRewardConditions(
        {
          operator: "all",
          conditions: [
            { key: "bad", metric: "attendance.count", comparator: "gte", target: "four" },
          ],
        },
        { "attendance.count": 4 },
      ),
    ).toThrow("reward_condition_numeric_target_required");
  });

  it("keeps one event able to feed multiple bound rules", async () => {
    const client = new FakeRewardProgressRpcClient();

    await expect(getRelevantRewardRulesForEvent(client, "event-1")).resolves.toHaveLength(2);
    expect(client.calls[0]).toEqual({
      functionName: "reward_rules_for_domain_event",
      args: { p_event_id: "event-1" },
    });
  });

  it("records progress independently from the later reward grant", async () => {
    const client = new FakeRewardProgressRpcClient();
    const evaluation = evaluateRewardConditions(
      {
        operator: "all",
        conditions: [
          { key: "attendance", metric: "attendance.count", comparator: "gte", target: 4 },
        ],
      },
      { "attendance.count": 4 },
    );

    await expect(
      recordRewardProgressEvaluation(client, {
        ruleId: "rule-1",
        versionNumber: 2,
        studentId: "student-1",
        cycleKey: "week:2026-09-14",
        idempotencyKey: "reward:rule-1:week:2026-09-14:event-1",
        evaluationKind: "event",
        outcome: "counted",
        candidateOccurredAt: "2026-09-19T18:00:00.000Z",
        conditionResults: evaluation.conditions,
        progress: { "attendance.count": 4 },
        eventId: "event-1",
        fulfilled: evaluation.fulfilled,
      }),
    ).resolves.toMatchObject({
      evaluationId: "evaluation-1",
      cycleId: "cycle-1",
      fulfilled: true,
    });
  });

  it("supports explicit cycle freeze", async () => {
    const client = new FakeRewardProgressRpcClient();

    await expect(
      transitionRewardCycle(client, {
        cycleId: "cycle-1",
        action: "freeze",
        reason: "Cierre del estudio",
      }),
    ).resolves.toBe("frozen");
  });

  it("locks the database contract to indexed events and append-only progress", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919203500_sf235_rewards_progress.sql"),
      "utf8",
    );

    expect(sql).toContain("reward_rule_event_bindings_event_idx");
    expect(sql).toContain("instead of scanning every reward rule");
    expect(sql).toContain("reward_progress_evaluations_idempotency_unique");
    expect(sql).toContain("reward_progress_evaluations_immutable");
    expect(sql).toContain("reward_cycle_events_immutable");
    expect(sql).toContain("reward_rules_for_domain_event");
    expect(sql).toContain("r.status = 'active'");
    expect(sql).toContain("allow_historical");
    expect(sql).toContain("reward_progress_candidate_before_eligibility");
    expect(sql).toContain("p_outcome = 'recalculated'");
    expect(sql).toContain("reward_progress_cycle_version_mismatch");
    expect(sql).toContain("to service_role");
  });
});
