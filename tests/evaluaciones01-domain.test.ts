import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const domainPath = join(
  process.cwd(),
  "supabase/migrations/20260921074309_evaluaciones01_domain_persistence.sql",
);
const hardeningPath = join(
  process.cwd(),
  "supabase/migrations/20260921074428_evaluaciones01_domain_hardening.sql",
);
const rlsHardeningPath = join(
  process.cwd(),
  "supabase/migrations/20260921074539_evaluaciones01_rls_performance_hardening.sql",
);

const domain = readFileSync(domainPath, "utf8");
const hardening = readFileSync(hardeningPath, "utf8");
const rlsHardening = readFileSync(rlsHardeningPath, "utf8");

describe("EVALUACIONES-01 technical evaluation domain", () => {
  it("separates technical levels from Rewards", () => {
    expect(domain).toContain("create table public.technical_level_definitions");
    expect(domain).toContain("create table public.discipline_technical_levels");
    expect(domain).toContain("create table public.student_discipline_levels");
    expect(domain).not.toContain("insert into public.reward_status_memberships");
    expect(domain).not.toContain("update public.reward_status_memberships");
  });

  it("seeds the approved technical terminology", () => {
    expect(domain).toContain("'beginner', 'Principiante', 1");
    expect(domain).toContain("'intermediate', 'Intermedio', 2");
    expect(domain).toContain("'upper_intermediate', 'Intermedio Avanzado', 3");
    expect(domain).toContain("'advanced', 'Avanzado', 4");
    expect(domain).toContain("'elite', 'Élite', 5");
  });

  it("supports versioned templates, figures, combos and live results", () => {
    expect(domain).toContain("create table public.evaluation_template_versions");
    expect(domain).toContain("create table public.evaluation_template_criteria");
    expect(domain).toContain("create table public.evaluation_template_elements");
    expect(domain).toContain("create table public.evaluation_template_combos");
    expect(domain).toContain("create table public.technical_evaluation_element_results");
    expect(domain).toContain("create table public.technical_evaluation_combo_results");
    expect(domain).toContain("create table public.technical_evaluation_criterion_results");
    expect(domain).toContain("quick_comments text[]");
  });

  it("preserves published history and requires the canonical publish flow", () => {
    expect(domain).toContain("published_evaluation_immutable");
    expect(domain).toContain("published_evaluation_results_immutable");
    expect(domain).toContain("evaluation_publish_rpc_required");
    expect(domain).toContain("supersedes_evaluation_id");
    expect(domain).toContain("evaluation_template_version_in_use");
    expect(hardening).toContain("tg_table_name = 'evaluation_template_versions'");
    expect(hardening).toContain("elsif tg_op = 'DELETE'");
  });

  it("uses explicit evaluation capabilities and student-only published reads", () => {
    expect(domain).toContain("'evaluations.read'");
    expect(domain).toContain("'evaluations.write'");
    expect(domain).toContain("'evaluations.configure'");
    expect(domain).toContain("status = 'published'");
    expect(domain).toContain("private.is_current_student(student_id, studio_id)");
  });

  it("avoids overlapping write/select RLS paths after hardening", () => {
    expect(rlsHardening).toContain("technical_levels_configure_insert");
    expect(rlsHardening).toContain("technical_levels_configure_update");
    expect(rlsHardening).toContain("technical_levels_configure_delete");
    expect(rlsHardening).toContain(
      "technical_evaluation_element_results_staff_insert",
    );
    expect(rlsHardening).toContain(
      "technical_evaluation_combo_results_staff_update",
    );
    expect(rlsHardening).toContain(
      "technical_evaluation_criterion_results_staff_delete",
    );
  });
});
