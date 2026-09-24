import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("RETOS-01", () => {
  it("exposes Retos as a separate admin and student module", () => {
    const adminLayout = read("app/admin/layout.tsx");
    const studentNav = read("app/student/StudentNav.tsx");

    expect(adminLayout).toContain('{ href: "/admin/retos", label: "Retos", enabled: true }');
    expect(adminLayout).toContain(
      '{ href: "/admin/recompensas", label: "Rewards", enabled: true }',
    );
    expect(studentNav).toContain('href: "/student/retos"');
  });

  it("configures individual and competitive challenge modes", () => {
    const form = read("app/admin/recompensas/RuleEditorForm.tsx");
    const actions = read("app/admin/recompensas/actions.ts");

    expect(form).toContain('value="individual"');
    expect(form).toContain('value="leaderboard"');
    expect(form).toContain('name="tie_breaker"');
    expect(form).toContain('name="winner_count"');
    expect(actions).toContain("competition_reward_definition");
    expect(actions).toContain("enrollment_required");
    expect(actions).toContain("ranking_places");
  });

  it("keeps competitive prizes out of threshold-based automatic rewards", () => {
    const actions = read("app/admin/recompensas/actions.ts");

    expect(actions).toContain("ruleRewardDefinition");
    expect(actions).toContain("? { rewards: [] }");
    expect(actions).toContain('rpc("admin_settle_reward_challenge"');
  });

  it("implements explicit enrollment and a privacy-safe Top 3", () => {
    const home = read("app/student/retos/page.tsx");
    const detail = read("app/student/retos/[ruleId]/page.tsx");
    const migration = read("supabase/migrations/20260924071218_retos01_competitive_challenges.sql");

    expect(home).toContain("Objetivos temporales, competencias y recompensas");
    expect(detail).toContain("Inscribirme al reto");
    expect(detail).toContain("Top 3");
    expect(detail).toContain("gap_to_top3");
    expect(migration).toContain("reward_challenge_enrollments");
    expect(migration).toContain("reward_challenge_masked_name");
    expect(migration).toContain("student_reward_challenge_leaderboard");
  });

  it("settles competitive prizes only after ranking closes", () => {
    const migration = read("supabase/migrations/20260924071922_retos01_competitive_settlement.sql");
    const fix = read("supabase/migrations/20260924072632_retos01_settlement_state_fix.sql");

    expect(migration).toContain("reward_challenge_settlements");
    expect(migration).toContain("system_settle_due_reward_challenges");
    expect(migration).toContain("admin_settle_reward_challenge");
    expect(fix).toContain("'competitive_challenge_winner'");
    expect(fix).toContain("set status = 'available'");
  });

  it("stores only meaningful challenge notification switches", () => {
    const form = read("app/admin/recompensas/RuleEditorForm.tsx");
    const actions = read("app/admin/recompensas/actions.ts");

    for (const key of [
      "challenge_started",
      "meaningful_progress",
      "near_goal",
      "entered_top3",
      "position_changed",
      "overtaken",
      "ending_soon",
      "completed",
      "results",
    ]) {
      expect(form).toContain(key);
      expect(actions).toContain(key);
    }
  });
});
