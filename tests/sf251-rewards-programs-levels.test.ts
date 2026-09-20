import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-251 Progress & Rewards V1 programs and levels", () => {
  const domain = read(
    "supabase/migrations/20260920125400_sf251_rewards_programs_levels.sql",
  );
  const rpc = read(
    "supabase/migrations/20260920125554_sf251_rewards_programs_rpc.sql",
  );
  const runtime = read(
    "supabase/migrations/20260920030853_rewards_runtime_wiring.sql",
  );

  it(
    "adds a versioned program domain above immutable reward rule versions",
    () => {
      for (const table of [
        "reward_programs",
        "reward_program_versions",
        "reward_program_levels",
        "reward_program_lifecycle",
        "reward_program_participations",
        "reward_program_level_unlocks",
        "reward_program_events",
      ]) {
        expect(domain).toContain(`create table public.${table}`);
      }

      expect(domain).toContain("'cumulative'");
      expect(domain).toContain("'sequential'");
      expect(domain).toContain("'draft'");
      expect(domain).toContain("'active'");
      expect(domain).toContain("'paused'");
      expect(domain).toContain("'archived'");
      expect(domain).toContain("reward_programs_published_version_fkey");
      expect(domain).toContain("reward_program_levels_rule_version_fkey");
    },
  );

  it(
    "preserves published history while allowing only unpublished drafts to change",
    () => {
      expect(domain).toContain("reward_program_published_version_immutable");
      expect(domain).toContain("reward_program_published_level_immutable");
      expect(domain).toContain("reward_program_level_unlocks_logical_unique");
      expect(domain).toContain("reward_program_level_unlocks_immutable");
      expect(domain).toContain("reward_program_events_immutable");
    },
  );

  it("supports configurable audiences and lock-on-join eligibility", () => {
    expect(rpc).toContain("'all_students'");
    expect(rpc).toContain("'all_active_students'");
    expect(rpc).toContain("'continuous'");
    expect(rpc).toContain("'lock_on_join'");
    expect(rpc).toContain("reward_program_student_eligible");
  });

  it("supports draft editing, publication and arbitrary ordered levels", () => {
    expect(rpc).toContain("admin_create_reward_program_version");
    expect(rpc).toContain("admin_update_reward_program_draft");
    expect(rpc).toContain("admin_replace_reward_program_levels");
    expect(rpc).toContain("reward_program_level_order_must_be_contiguous");
    expect(rpc).toContain("admin_publish_reward_program");
    expect(rpc).toContain("admin_transition_reward_program");
  });

  it(
    "materializes zero-progress students and keeps permanent level unlocks",
    () => {
      expect(rpc).toContain("system_materialize_reward_program_participation");
      expect(rpc).toContain("system_materialize_reward_program_participations");
      expect(rpc).toContain("system_record_reward_program_level_completion");
      expect(rpc).toContain(
        "v_participation.current_level_order is distinct from v_level.level_order",
      );
      expect(rpc).toContain("'program_completed'");
    },
  );

  it(
    "reuses the existing outcomes engine for zero, one or many outcomes",
    () => {
      expect(runtime).toContain(
        "jsonb_typeof(v_version.reward_definition->'rewards') = 'array'",
      );
      expect(runtime).toContain(
        "jsonb_array_elements(v_version.reward_definition->'rewards')",
      );
      expect(runtime).toContain("v_reward_item->>'kind' = 'badge'");
      expect(runtime).toContain("system_generate_reward_instance");
    },
  );

  it("keeps student reads scoped through Rewards RLS", () => {
    expect(domain).toContain(
      "private.has_capability(studio_id, 'rewards.read')",
    );
    expect(domain).toContain(
      "private.is_reward_student_self(studio_id, student_id)",
    );
    expect(domain).not.toContain("create policy reward_programs_write");
  });
});
