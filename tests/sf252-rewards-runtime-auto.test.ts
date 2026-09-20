import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const runtimePath = join(
  process.cwd(),
  "supabase/migrations/20260920132429_sf252_rewards_runtime_auto.sql",
);

const cleanupPath = join(
  process.cwd(),
  "supabase/migrations/20260920165431_sf254_remove_rewards_incidents.sql",
);

const runtime = readFileSync(runtimePath, "utf8");
const cleanup = readFileSync(cleanupPath, "utf8");

describe("SF-252 automatic Rewards runtime", () => {
  it("materializes eligible participations", () => {
    expect(runtime).toContain("system_materialize_reward_runtime_for_student");
    expect(runtime).toContain("reward_materialize_student_runtime");
    expect(runtime).toContain("reward_materialize_rule_runtime");
    expect(runtime).toContain("reward_materialize_program_runtime");
  });

  it("uses configured eligibility", () => {
    expect(runtime).toContain("reward_rule_student_eligible");
    expect(runtime).toContain("'all_students'");
    expect(runtime).toContain("'all_active_students'");
    expect(runtime).toContain("'lock_on_join'");
    expect(runtime).not.toContain("'student_not_active'");
  });

  it("gates sequential program metrics", () => {
    expect(runtime).toContain("reward_rule_runtime_allowed");
    expect(runtime).toContain("pp.current_level_order = l.level_order");
    expect(runtime).toContain("reward_rule_program_window_start_at");
    expect(runtime).toContain("reward_trim_loyalty_state_from");
  });

  it("applies fulfilled progress to programs", () => {
    expect(runtime).toContain("reward_progress_program_completion");
    expect(runtime).toContain("system_record_reward_program_level_completion");
  });

  it("keeps runtime failures downstream without incidents", () => {
    expect(cleanup).toContain("private.reward_try_process_domain_event");
    expect(cleanup).toContain("system_process_reward_domain_event");
    expect(cleanup).not.toContain("runtime_processing_error");
    expect(cleanup).not.toContain("system_open_reward_incident(");
  });
});
