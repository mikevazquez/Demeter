import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("SF-234 rewards domain", () => {
  it("locks the approved families, lifecycle and frozen reward contract", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919200000_sf234_rewards_domain.sql"),
      "utf8",
    );

    for (const family of ["loyalty", "attendance", "challenge", "achievement"]) {
      expect(sql).toContain(`'${family}'`);
    }

    for (const status of ["blocked", "available", "reserved", "redeemed", "expired", "revoked"]) {
      expect(sql).toContain(`'${status}'`);
    }

    expect(sql).toContain("reward_rule_versions_rule_version_unique");
    expect(sql).toContain("reward_rules_current_version_fkey");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("reward_rule_versions_immutable");
    expect(sql).toContain("reward_rule_lifecycle_immutable");
    expect(sql).toContain("reward_progress_snapshots_immutable");
    expect(sql).toContain("reward_instance_events_immutable");
    expect(sql).toContain("reward_incident_events_immutable");
    expect(sql).toContain("reward_instances_idempotency_unique");
    expect(sql).toContain("manually_granted");
    expect(sql).toContain("manual_reason");
    expect(sql).toContain("rewards.read");
    expect(sql).toContain("rewards.manage");
    expect(sql).toContain("private.is_reward_student_self");
    expect(sql).toContain(
      "Operational attendance, packages, sales and domain events remain the source of truth",
    );
    expect(sql).toContain("Rule changes never rewrite an already generated reward");
  });

  it("keeps progress snapshots separate from source-of-truth tables", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260919200000_sf234_rewards_domain.sql"),
      "utf8",
    );

    expect(sql).toContain("create table public.reward_progress_snapshots");
    expect(sql).toContain("evidence_summary jsonb");
    expect(sql).toContain("source_through timestamptz");
    expect(sql).not.toContain("alter table public.reservations add column reward_progress");
    expect(sql).not.toContain("alter table public.product_acquisitions add column reward_progress");
  });
});
