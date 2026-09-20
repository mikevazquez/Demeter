// SF-252 contract coverage for the automatic Rewards runtime.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const runtime = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260920132429_sf252_rewards_runtime_auto.sql",
  ),
  "utf8",
);

describe("SF-252 automatic Rewards runtime", () => {
  it("materializes eligible rule and program participations", () => {
    expect(runtime).toContain("system_materialize_reward_runtime_for_student");
    expect(runtime).toContain("reward_materialize_student_runtime");
    expect(runtime).toContain("reward_materialize_rule_runtime");
    expect(runtime).toContain("reward_materialize_program_runtime");
  });

  it("supports configured eligibility instead of a global active-student guard", () => {
    expect(runtime).toContain("reward_rule_student_eligible");
    expect(runtime).toContain("'all_students'");
    expect(runtime).toContain("'all_active_students'");
    expect(runtime).toContain("'lock_on_join'");
    expect(runtime).not.toContain(
      "return jsonb_build_object('processed', 0, 'reason', 'student_not_active')",
    );
  });

  it("gates sequential programs and scopes their metric window", () => {
    expect(runtime).toContain("reward_rule_runtime_allowed");
    expect(runtime).toContain("pp.current_level_order = l.level_order");
    expect(runtime).toContain("reward_rule_program_window_start_at");
    expect(runtime).toContain("reward_trim_loyalty_state_from");
  });

  it("turns fulfilled evaluations into permanent program progress", () => {
    expect(runtime).toContain("reward_progress_program_completion");
    expect(runtime).toContain("system_record_reward_program_level_completion");
  });

  it("keeps Rewards downstream and auditable on failures", () => {
    expect(runtime).toContain("runtime_processing_error");
    expect(runtime).toContain("system_open_reward_incident");
  });
});
