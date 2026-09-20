import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const domainPath = join(
  process.cwd(),
  "supabase/migrations/20260920125400_sf251_rewards_programs_levels.sql",
);
const rpcPath = join(
  process.cwd(),
  "supabase/migrations/20260920125554_sf251_rewards_programs_rpc.sql",
);
const runtimePath = join(
  process.cwd(),
  "supabase/migrations/20260920030853_rewards_runtime_wiring.sql",
);

const domain = readFileSync(domainPath, "utf8");
const rpc = readFileSync(rpcPath, "utf8");
const runtime = readFileSync(runtimePath, "utf8");

describe("SF-251 rewards programs", () => {
  it("creates the versioned program domain", () => {
    expect(domain).toContain("create table public.reward_programs");
    expect(domain).toContain("create table public.reward_program_versions");
    expect(domain).toContain("create table public.reward_program_levels");
    expect(domain).toContain("'cumulative'");
    expect(domain).toContain("'sequential'");
  });

  it("locks published history", () => {
    expect(domain).toContain("reward_program_published_version_immutable");
    expect(domain).toContain("reward_program_published_level_immutable");
    expect(domain).toContain("reward_program_level_unlocks_immutable");
    expect(domain).toContain("reward_program_events_immutable");
  });

  it("supports configurable progression", () => {
    expect(rpc).toContain("'all_students'");
    expect(rpc).toContain("'all_active_students'");
    expect(rpc).toContain("'continuous'");
    expect(rpc).toContain("'lock_on_join'");
    expect(rpc).toContain("admin_publish_reward_program");
    expect(rpc).toContain("system_record_reward_program_level_completion");
  });

  it("reuses the existing outcomes engine", () => {
    expect(runtime).toContain("jsonb_array_elements");
    expect(runtime).toContain("system_unlock_reward_achievement");
    expect(runtime).toContain("system_generate_reward_instance");
  });
});
