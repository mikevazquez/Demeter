import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateAndRecordLoyaltyProgress,
  getRewardLoyaltyState,
  loyaltyCycleKey,
  loyaltyProgressMetrics,
} from "../lib/rewards/loyalty";
import type { RewardProgressRpcClient, RewardProgressRpcResult } from "../lib/rewards/progress";

class FakeLoyaltyRpcClient implements RewardProgressRpcClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardProgressRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_compute_reward_loyalty_state") {
      return {
        data: {
          rule_id: "rule-1",
          version_number: 2,
          student_id: "student-1",
          as_of_date: "2026-09-19",
          eligibility_start_date: "2026-04-01",
          grace_days: 7,
          allow_historical: false,
          count_zero_value_periods: false,
          count_unpaid_periods: false,
          current_consecutive_periods: 6,
          total_paid_periods: 9,
          best_consecutive_periods: 6,
          current_coverage_start: "2026-04-01",
          current_coverage_end: "2026-10-01",
          active_coverage: true,
          in_grace: false,
          effective_days_since_coverage: 0,
          counted_periods: [{ acquisition_id: "acq-1", streak_after_period: 6 }],
          excluded_periods: [{ acquisition_id: "acq-2", reason_code: "future_period" }],
        } as T,
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

    return { data: null, error: { message: `unexpected_rpc:${functionName}` } };
  }
}

describe("SF-237 rewards loyalty", () => {
  it("reads current streak separately from historical paid periods", async () => {
    const client = new FakeLoyaltyRpcClient();

    const state = await getRewardLoyaltyState(client, {
      ruleId: "rule-1",
      versionNumber: 2,
      studentId: "student-1",
      asOfDate: "2026-09-19",
    });

    expect(state.currentConsecutivePeriods).toBe(6);
    expect(state.totalPaidPeriods).toBe(9);
    expect(state.bestConsecutivePeriods).toBe(6);
    expect(state.activeCoverage).toBe(true);
    expect(client.calls[0]).toEqual({
      functionName: "system_compute_reward_loyalty_state",
      args: {
        p_rule_id: "rule-1",
        p_version_number: 2,
        p_student_id: "student-1",
        p_as_of_date: "2026-09-19",
      },
    });
  });

  it("exposes loyalty facts to the generic ALL/ANY condition engine", async () => {
    const client = new FakeLoyaltyRpcClient();
    const result = await evaluateAndRecordLoyaltyProgress(client, {
      ruleId: "rule-1",
      versionNumber: 2,
      studentId: "student-1",
      candidateOccurredAt: "2026-09-19T18:00:00.000Z",
      idempotencyKey: "loyalty:rule-1:v2:student-1:2026-09-19",
      conditionDefinition: {
        operator: "all",
        conditions: [
          {
            key: "six-periods",
            metric: "loyalty.current_consecutive_periods",
            comparator: "gte",
            target: 6,
          },
          {
            key: "covered",
            metric: "loyalty.active_coverage",
            comparator: "eq",
            target: true,
          },
        ],
      },
    });

    expect(result.progress.fulfilled).toBe(true);
    expect(client.calls[1]?.functionName).toBe("system_record_reward_progress_evaluation");
    expect(client.calls[1]?.args).toMatchObject({
      p_cycle_key: "loyalty:v2",
      p_evaluation_kind: "recalculation",
      p_outcome: "recalculated",
      p_fulfilled: true,
    });
  });

  it("keeps stable versioned cycle keys and loyalty metrics", async () => {
    const client = new FakeLoyaltyRpcClient();
    const state = await getRewardLoyaltyState(client, {
      ruleId: "rule-1",
      versionNumber: 2,
      studentId: "student-1",
    });

    expect(loyaltyCycleKey(2)).toBe("loyalty:v2");
    expect(() => loyaltyCycleKey(0)).toThrow("reward_loyalty_version_invalid");
    expect(loyaltyProgressMetrics(state)).toEqual({
      "loyalty.current_consecutive_periods": 6,
      "loyalty.total_paid_periods": 9,
      "loyalty.best_consecutive_periods": 6,
      "loyalty.active_coverage": true,
      "loyalty.in_grace": false,
    });
  });

  it("locks the SQL contract to periods rather than purchase count", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919213000_sf237_rewards_loyalty.sql"),
      "utf8",
    );

    expect(sql).toContain("pt.product_type in ('package', 'membership')");
    expect(sql).toContain("v_candidate.starts_on > v_as_of");
    expect(sql).toContain("'future_period'");
    expect(sql).toContain("'queued_overlap'");
    expect(sql).toContain("'duplicate_coverage'");
    expect(sql).toContain("v_effective_start := v_current_coverage_end + 1");
    expect(sql).toContain("v_total_paid_periods := v_total_paid_periods + 1");
    expect(sql).toContain("v_current_streak := v_current_streak + 1");
    expect(sql).toContain("v_gap_effective > v_grace_days");
    expect(sql).toContain("private.reward_loyalty_frozen_days");
  });

  it("excludes free, unpaid, cancelled and refunded periods by default", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919213000_sf237_rewards_loyalty.sql"),
      "utf8",
    );

    expect(sql).toContain("count_zero_value_periods");
    expect(sql).toContain("count_unpaid_periods");
    expect(sql).toContain("'zero_value_period'");
    expect(sql).toContain("'payment_not_recorded'");
    expect(sql).toContain("'not_purchase_backed'");
    expect(sql).toContain("'cancelled_or_refunded'");
    expect(sql).toContain("line_net_paid_minor");
    expect(sql).toContain("sale_net_paid_minor");
    expect(sql).toContain("allow_historical");
    expect(sql).toContain("'before_rule_eligibility'");
    expect(sql).toContain("to service_role");
  });
});
