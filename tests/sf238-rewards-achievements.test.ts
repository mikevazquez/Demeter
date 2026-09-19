import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unlockRewardAchievement } from "../lib/rewards/achievements";
import {
  attendanceProgressMetrics,
  evaluateAndRecordAttendanceProgress,
  getRewardAttendanceState,
} from "../lib/rewards/attendance";
import type { RewardProgressRpcClient, RewardProgressRpcResult } from "../lib/rewards/progress";

class FakeAttendanceRpcClient implements RewardProgressRpcClient {
  readonly calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<RewardProgressRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "system_compute_reward_attendance_state") {
      return {
        data: {
          rule_id: "rule-1",
          version_number: 1,
          student_id: "student-1",
          as_of_date: "2026-09-19",
          window_start: "2026-09-01",
          window_end: "2026-09-19",
          allow_historical: false,
          attendance_max_one_per_day: false,
          raw_attendance_count: 5,
          counted_attendance_count: 5,
          distinct_attendance_days: 3,
          distinct_attendance_weeks: 1,
          distinct_attendance_months: 1,
          distinct_disciplines: 2,
          no_show_count: 1,
          cancellation_count: 1,
          attended_dates: ["2026-09-17", "2026-09-18", "2026-09-19"],
          attended_weeks: ["2026-09-14"],
          attended_months: ["2026-09-01"],
          no_show_dates: ["2026-09-18"],
          cancellation_dates: ["2026-09-10"],
          counted_reservation_ids: ["reservation-1", "reservation-2"],
          discipline_counts: {
            "discipline-pole": {
              discipline_id: "discipline-pole",
              name: "Pole Fitness",
              attendance_count: 3,
            },
            "discipline-twerk": {
              discipline_id: "discipline-twerk",
              name: "Twerk",
              attendance_count: 2,
            },
          },
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

    if (functionName === "system_unlock_reward_achievement") {
      return {
        data: {
          achievement_unlock_id: "unlock-1",
          created: true,
          unlocked_at: "2026-09-19T20:00:00.000Z",
        } as T,
        error: null,
      };
    }

    return { data: null, error: { message: `unexpected_rpc:${functionName}` } };
  }
}

describe("SF-238 attendance, challenges and achievements", () => {
  it("uses attended status as the attendance source and exposes variety", async () => {
    const client = new FakeAttendanceRpcClient();
    const state = await getRewardAttendanceState(client, {
      ruleId: "rule-1",
      versionNumber: 1,
      studentId: "student-1",
      asOfDate: "2026-09-19",
    });
    const metrics = attendanceProgressMetrics(state);

    expect(metrics["attendance.count"]).toBe(5);
    expect(metrics["attendance.distinct_days"]).toBe(3);
    expect(metrics["attendance.distinct_disciplines"]).toBe(2);
    expect(metrics["attendance.discipline.discipline-pole.count"]).toBe(3);
    expect(metrics["attendance.streak.days.current"]).toBe(3);
    expect(metrics["attendance.streak.days.best"]).toBe(3);
  });

  it("can make no-show break continuity without deleting attendance volume", async () => {
    const client = new FakeAttendanceRpcClient();
    const state = await getRewardAttendanceState(client, {
      ruleId: "rule-1",
      versionNumber: 1,
      studentId: "student-1",
    });
    const metrics = attendanceProgressMetrics(state, { noShowBreaksStreak: true });

    expect(metrics["attendance.count"]).toBe(5);
    expect(metrics["attendance.no_show_count"]).toBe(1);
    expect(metrics["attendance.streak.days.current"]).toBe(1);
    expect(metrics["attendance.streak.days.best"]).toBe(1);
  });

  it("feeds challenge conditions through the shared progress engine", async () => {
    const client = new FakeAttendanceRpcClient();

    const result = await evaluateAndRecordAttendanceProgress(client, {
      ruleId: "rule-1",
      versionNumber: 1,
      studentId: "student-1",
      cycleKey: "challenge:september",
      candidateOccurredAt: "2026-09-19T20:00:00.000Z",
      idempotencyKey: "challenge:september:student-1:recalc:2026-09-19",
      conditionDefinition: {
        operator: "all",
        conditions: [
          {
            key: "volume",
            metric: "attendance.count",
            comparator: "gte",
            target: 5,
          },
          {
            key: "variety",
            metric: "attendance.distinct_disciplines",
            comparator: "gte",
            target: 2,
          },
        ],
      },
    });

    expect(result.progress.fulfilled).toBe(true);
    expect(client.calls[1]?.args).toMatchObject({
      p_cycle_key: "challenge:september",
      p_fulfilled: true,
    });
  });

  it("unlocks permanent achievement evidence idempotently through one RPC", async () => {
    const client = new FakeAttendanceRpcClient();

    await expect(
      unlockRewardAchievement(client, {
        sourceEvaluationId: "evaluation-1",
        achievementKey: "constancia-5",
        levelKey: "bronze",
        title: "Constancia 5",
        badgeSnapshot: { icon: "star", hidden_before_unlock: true },
      }),
    ).resolves.toEqual({
      achievementUnlockId: "unlock-1",
      created: true,
      unlockedAt: "2026-09-19T20:00:00.000Z",
    });

    expect(client.calls[0]?.functionName).toBe("system_unlock_reward_achievement");
  });

  it("locks database rules for attended-only progress and permanent achievements", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919222000_sf238_rewards_achievements.sql"),
      "utf8",
    );

    expect(sql).toContain("r.status in (");
    expect(sql).toContain("'attended'");
    expect(sql).toContain("where s.reservation_status = 'attended'");
    expect(sql).toContain("attendance_max_one_per_day");
    expect(sql).toContain("distinct_attendance_days");
    expect(sql).toContain("distinct_disciplines");
    expect(sql).toContain("no_show_count");
    expect(sql).toContain("cancellation_count");
    expect(sql).toContain("reward_achievement_unlocks_student_key_unique");
    expect(sql).toContain("reward_achievement_unlocks_immutable");
    expect(sql).toContain("reward_achievement_source_not_fulfilled");
    expect(sql).toContain("to service_role");
  });
});
