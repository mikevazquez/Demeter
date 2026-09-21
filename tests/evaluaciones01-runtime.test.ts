import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const runtimePath = join(
  process.cwd(),
  "supabase/migrations/20260921075950_evaluaciones01_runtime_rpc.sql",
);
const guardPath = join(
  process.cwd(),
  "supabase/migrations/20260921080012_evaluaciones01_criterion_result_guard.sql",
);
const timestampPath = join(
  process.cwd(),
  "supabase/migrations/20260921080150_evaluaciones01_criterion_result_timestamp.sql",
);
const fixPath = join(
  process.cwd(),
  "supabase/migrations/20260921080228_evaluaciones01_runtime_calculation_fix.sql",
);
const completionGatePath = join(
  process.cwd(),
  "supabase/migrations/20260921223200_evaluaciones01_completion_gate.sql",
);
const directScoringPath = join(
  process.cwd(),
  "supabase/migrations/20260921231000_evaluaciones01_direct_criterion_scoring.sql",
);

const runtime = readFileSync(runtimePath, "utf8");
const guard = readFileSync(guardPath, "utf8");
const timestamp = readFileSync(timestampPath, "utf8");
const fix = readFileSync(fixPath, "utf8");
const completionGate = readFileSync(completionGatePath, "utf8");
const directScoring = readFileSync(directScoringPath, "utf8");

describe("EVALUACIONES-01 runtime", () => {
  it("creates and autosaves draft evaluations through capability-gated RPCs", () => {
    expect(runtime).toContain("public.admin_create_technical_evaluation");
    expect(runtime).toContain("public.admin_save_technical_element_result");
    expect(runtime).toContain("public.admin_save_technical_combo_result");
    expect(runtime).toContain("private.evaluations_assert_draft");
    expect(runtime).toContain("'evaluations.write'");
  });

  it("calculates weighted criteria and the three approved outcomes", () => {
    expect(runtime).toContain("public.admin_recalculate_technical_evaluation");
    expect(runtime).toContain("v_version.pass_threshold");
    expect(runtime).toContain("v_version.default_category_min");
    expect(fix).toContain("when v_incomplete then 'incomplete'");
    expect(fix).toContain("when v_mandatory_failed then 'stays'");
    expect(fix).toContain("else 'approved'");
  });

  it("publishes through one canonical path and updates only technical progression", () => {
    expect(runtime).toContain("public.admin_publish_technical_evaluation");
    expect(runtime).toContain("insert into public.student_discipline_levels");
    expect(runtime).toContain("source_evaluation_id");
    expect(runtime).not.toContain("update public.reward_status_memberships");
    expect(runtime).not.toContain("insert into public.reward_status_memberships");
  });

  it("keeps any missing technical capture incomplete and blocks publication", () => {
    expect(completionGate).toContain("private.evaluations_capture_incomplete");
    expect(completionGate).toContain("coalesce(er.result_status, 'not_evaluated')");
    expect(completionGate).toContain("coalesce(cr.result_status, 'not_evaluated')");
    expect(completionGate).toContain("te.scored and er.score is null");
    expect(completionGate).toContain("tc.scored and cr.score is null");
    expect(completionGate).toContain("automatic_outcome = 'incomplete'");
    expect(completionGate).toContain("technical_evaluations_completion_gate");
    expect(completionGate).toContain("raise exception 'evaluation_incomplete'");
  });

  it("captures every weighted criterion directly before technical close", () => {
    expect(directScoring).toContain("public.admin_save_technical_criterion_result");
    expect(directScoring).toContain("add column if not exists captured_at");
    expect(directScoring).toContain("r.captured_at is null");
    expect(directScoring).toContain("sum(r.weighted_points)");
    expect(directScoring).not.toContain(
      "delete from public.technical_evaluation_criterion_results",
    );
  });

  it("keeps criterion history under the published-result guard", () => {
    expect(guard).toContain("technical_evaluation_criterion_results_guard");
    expect(timestamp).toContain("add column if not exists updated_at");
    expect(guard).toContain("private.evaluations_guard_result_history()");
  });
});
