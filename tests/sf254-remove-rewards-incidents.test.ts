import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260920165431_sf254_remove_rewards_incidents.sql",
  ),
  "utf8",
);
const actions = readFileSync(
  join(process.cwd(), "app/admin/recompensas/actions.ts"),
  "utf8",
);

describe("SF-254 Rewards incident removal", () => {
  it("removes the Rewards incident schema and RPCs", () => {
    expect(migration).toContain(
      "drop table if exists public.reward_incident_events",
    );
    expect(migration).toContain("drop table if exists public.reward_incidents");
    expect(migration).toContain(
      "drop type if exists public.reward_incident_status",
    );
    expect(migration).toContain(
      "drop type if exists public.reward_incident_priority",
    );
    expect(migration).toContain(
      "drop function if exists public.system_open_reward_incident",
    );
    expect(migration).toContain(
      "drop function if exists public.admin_resolve_reward_incident",
    );
  });

  it("removes incident_definition from the live rule contract", () => {
    expect(migration).toContain(
      "alter table public.reward_rule_versions drop column if exists incident_definition",
    );
    expect(actions).not.toContain("p_incident_definition");
  });

  it("keeps corrections deterministic and audited", () => {
    expect(migration).toContain("'blocked', 'available', 'reserved'");
    expect(migration).toContain("'progress_correction_after_redemption'");
    expect(migration).toContain("'redeemed_preserved'");
    expect(migration).toContain("'adjusted'");
  });

  it("keeps exceptional admin adjustment without incident mediation", () => {
    expect(migration).toContain(
      "private.admin_adjust_reward_instance_internal",
    );
    expect(migration).toContain("reward_adjustment_reason_required");
    expect(migration).toContain("private.revoke_reward_available_internal");
    expect(migration).not.toContain("manual_reward_review");
  });

  it("leaves failed domain events unconsumed for retry", () => {
    expect(migration).toContain("private.reward_try_process_domain_event");
    expect(migration).toContain("exception when others then");
    expect(migration).not.toContain("runtime_processing_error");
  });
});
