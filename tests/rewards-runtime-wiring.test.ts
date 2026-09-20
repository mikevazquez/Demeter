import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("REWARDS runtime wiring", () => {
  it("derives bindings from reward metrics without coupling to frontend code", () => {
    const migration = read("supabase/migrations/20260920033000_rewards_runtime_wiring.sql");

    expect(migration).toContain("reward_sync_rule_event_bindings");
    expect(migration).toContain("attendance.finalized");
    expect(migration).toContain("attendance.corrected");
    expect(migration).toContain("loyalty.changed");
    expect(migration).toContain("reward_rules_for_domain_event");
  });

  it("keeps source operations independent from Rewards failures", () => {
    const migration = read("supabase/migrations/20260920033000_rewards_runtime_wiring.sql");

    expect(migration).toContain("reward_try_process_domain_event");
    expect(migration).toContain("exception when others");
    expect(migration).toContain("Never fail the source operation");
  });

  it("uses the canonical progress and lifecycle RPCs", () => {
    const migration = read("supabase/migrations/20260920033000_rewards_runtime_wiring.sql");

    expect(migration).toContain("system_record_reward_progress_evaluation");
    expect(migration).toContain("system_generate_reward_instance");
    expect(migration).toContain("system_unlock_reward_achievement");
    expect(migration).toContain("system_reconcile_reward_correction");
    expect(migration).not.toContain("insert into public.reward_instances");
  });

  it("emits finalized attendance and recalculates after the reservation changes", () => {
    const runtime = read("supabase/migrations/20260920033000_rewards_runtime_wiring.sql");
    const correction = read(
      "supabase/migrations/20260920034000_rewards_attendance_correction_order_fix.sql",
    );

    expect(runtime).toContain("new.status = 'completed'");
    expect(runtime).toContain("reward_emit_attendance_finalized");
    expect(correction).toContain("after update of status on public.reservations");
    expect(correction).toContain("v_session_status <> 'completed'");
  });

  it("keeps loyalty driven by acquisition and payment facts", () => {
    const migration = read("supabase/migrations/20260920033000_rewards_runtime_wiring.sql");

    expect(migration).toContain("reward_emit_loyalty_acquisition_changed");
    expect(migration).toContain("reward_emit_loyalty_payment_changed");
    expect(migration).toContain("product_acquisitions");
    expect(migration).toContain("public.payments");
  });

  it("blocks new progress for inactive students before evaluating bound rules", () => {
    const guard = read(
      "supabase/migrations/20260920035000_rewards_active_student_guard.sql",
    );

    expect(guard).toContain("s.active = true");
    expect(guard).toContain("s.lifecycle_status = 'active'");
    expect(guard).toContain("'student_not_active'");
    expect(guard).toContain("claim_domain_event");
  });

  it("fixes the canonical participation enum instead of adding a parallel writer", () => {
    const patch = read("supabase/migrations/20260920033500_rewards_progress_enum_fix.sql");

    expect(patch).toContain("'fulfilled'::public.reward_participation_status");
    expect(patch).toContain("'in_progress'::public.reward_participation_status");
    expect(patch).toContain(
      "create or replace function public.system_record_reward_progress_evaluation",
    );
  });
});
