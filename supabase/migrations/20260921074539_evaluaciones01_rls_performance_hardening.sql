
-- EVALUACIONES-01-01 · RLS/performance hardening.
-- Remove overlapping SELECT paths introduced by FOR ALL policies
-- and add covering indexes for the module's foreign keys.

drop policy if exists technical_levels_configure on public.technical_level_definitions;
create policy technical_levels_configure_insert
on public.technical_level_definitions for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_levels_configure_update
on public.technical_level_definitions for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_levels_configure_delete
on public.technical_level_definitions for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists discipline_technical_levels_configure on public.discipline_technical_levels;
create policy discipline_technical_levels_configure_insert
on public.discipline_technical_levels for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy discipline_technical_levels_configure_update
on public.discipline_technical_levels for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy discipline_technical_levels_configure_delete
on public.discipline_technical_levels for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists technical_elements_configure on public.technical_elements;
create policy technical_elements_configure_insert
on public.technical_elements for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_elements_configure_update
on public.technical_elements for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_elements_configure_delete
on public.technical_elements for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists technical_combos_configure on public.technical_combos;
create policy technical_combos_configure_insert
on public.technical_combos for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_combos_configure_update
on public.technical_combos for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_combos_configure_delete
on public.technical_combos for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists technical_combo_items_configure on public.technical_combo_items;
create policy technical_combo_items_configure_insert
on public.technical_combo_items for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_combo_items_configure_update
on public.technical_combo_items for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy technical_combo_items_configure_delete
on public.technical_combo_items for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_templates_configure on public.evaluation_templates;
create policy evaluation_templates_configure_insert
on public.evaluation_templates for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_templates_configure_update
on public.evaluation_templates for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_templates_configure_delete
on public.evaluation_templates for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_template_versions_configure on public.evaluation_template_versions;
create policy evaluation_template_versions_configure_insert
on public.evaluation_template_versions for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_versions_configure_update
on public.evaluation_template_versions for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_versions_configure_delete
on public.evaluation_template_versions for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_template_criteria_configure on public.evaluation_template_criteria;
create policy evaluation_template_criteria_configure_insert
on public.evaluation_template_criteria for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_criteria_configure_update
on public.evaluation_template_criteria for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_criteria_configure_delete
on public.evaluation_template_criteria for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_template_elements_configure on public.evaluation_template_elements;
create policy evaluation_template_elements_configure_insert
on public.evaluation_template_elements for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_elements_configure_update
on public.evaluation_template_elements for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_elements_configure_delete
on public.evaluation_template_elements for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_template_combos_configure on public.evaluation_template_combos;
create policy evaluation_template_combos_configure_insert
on public.evaluation_template_combos for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_combos_configure_update
on public.evaluation_template_combos for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_template_combos_configure_delete
on public.evaluation_template_combos for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists evaluation_quick_comments_configure on public.evaluation_quick_comments;
create policy evaluation_quick_comments_configure_insert
on public.evaluation_quick_comments for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_quick_comments_configure_update
on public.evaluation_quick_comments for update to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));
create policy evaluation_quick_comments_configure_delete
on public.evaluation_quick_comments for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'));

drop policy if exists technical_evaluation_element_results_staff_write on public.technical_evaluation_element_results;
create policy technical_evaluation_element_results_staff_insert
on public.technical_evaluation_element_results for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_element_results_staff_update
on public.technical_evaluation_element_results for update to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_element_results_staff_delete
on public.technical_evaluation_element_results for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.write'));

drop policy if exists technical_evaluation_combo_results_staff_write on public.technical_evaluation_combo_results;
create policy technical_evaluation_combo_results_staff_insert
on public.technical_evaluation_combo_results for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_combo_results_staff_update
on public.technical_evaluation_combo_results for update to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_combo_results_staff_delete
on public.technical_evaluation_combo_results for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.write'));

drop policy if exists technical_evaluation_criterion_results_staff_write on public.technical_evaluation_criterion_results;
create policy technical_evaluation_criterion_results_staff_insert
on public.technical_evaluation_criterion_results for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_criterion_results_staff_update
on public.technical_evaluation_criterion_results for update to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));
create policy technical_evaluation_criterion_results_staff_delete
on public.technical_evaluation_criterion_results for delete to authenticated
using (private.has_capability(studio_id, 'evaluations.write'));

create index if not exists discipline_technical_levels_discipline_fk_idx
  on public.discipline_technical_levels(discipline_id);
create index if not exists discipline_technical_levels_level_fk_idx
  on public.discipline_technical_levels(technical_level_id);
create index if not exists evaluation_quick_comments_discipline_fk_idx
  on public.evaluation_quick_comments(discipline_id);
create index if not exists evaluation_template_combos_combo_fk_idx
  on public.evaluation_template_combos(combo_id);
create index if not exists evaluation_template_combos_criterion_fk_idx
  on public.evaluation_template_combos(criterion_id);
create index if not exists evaluation_template_elements_criterion_fk_idx
  on public.evaluation_template_elements(criterion_id);
create index if not exists evaluation_template_elements_element_fk_idx
  on public.evaluation_template_elements(element_id);
create index if not exists evaluation_template_versions_created_by_fk_idx
  on public.evaluation_template_versions(created_by);
create index if not exists evaluation_templates_created_by_fk_idx
  on public.evaluation_templates(created_by);
create index if not exists evaluation_templates_discipline_fk_idx
  on public.evaluation_templates(discipline_id);
create index if not exists evaluation_templates_level_fk_idx
  on public.evaluation_templates(discipline_technical_level_id);
create index if not exists student_discipline_levels_level_fk_idx
  on public.student_discipline_levels(discipline_technical_level_id);
create index if not exists student_discipline_levels_source_eval_fk_idx
  on public.student_discipline_levels(source_evaluation_id);
create index if not exists technical_combo_items_element_fk_idx
  on public.technical_combo_items(element_id);
create index if not exists technical_combo_items_studio_fk_idx
  on public.technical_combo_items(studio_id);
create index if not exists technical_combos_discipline_fk_idx
  on public.technical_combos(discipline_id);
create index if not exists technical_elements_discipline_fk_idx
  on public.technical_elements(discipline_id);
create index if not exists technical_eval_combo_results_studio_fk_idx
  on public.technical_evaluation_combo_results(studio_id);
create index if not exists technical_eval_combo_results_template_fk_idx
  on public.technical_evaluation_combo_results(template_combo_id);
create index if not exists technical_eval_criterion_results_studio_fk_idx
  on public.technical_evaluation_criterion_results(studio_id);
create index if not exists technical_eval_criterion_results_template_fk_idx
  on public.technical_evaluation_criterion_results(template_criterion_id);
create index if not exists technical_eval_element_results_studio_fk_idx
  on public.technical_evaluation_element_results(studio_id);
create index if not exists technical_eval_element_results_template_fk_idx
  on public.technical_evaluation_element_results(template_element_id);
create index if not exists technical_eval_events_actor_fk_idx
  on public.technical_evaluation_events(actor_user_id);
create index if not exists technical_eval_events_evaluation_fk_idx
  on public.technical_evaluation_events(evaluation_id);
create index if not exists technical_evaluations_created_by_fk_idx
  on public.technical_evaluations(created_by);
create index if not exists technical_evaluations_current_level_fk_idx
  on public.technical_evaluations(current_discipline_level_id_at_start);
create index if not exists technical_evaluations_discipline_fk_idx
  on public.technical_evaluations(discipline_id);
create index if not exists technical_evaluations_evaluator_fk_idx
  on public.technical_evaluations(evaluator_user_id);
create index if not exists technical_evaluations_override_by_fk_idx
  on public.technical_evaluations(override_by);
create index if not exists technical_evaluations_resulting_level_fk_idx
  on public.technical_evaluations(resulting_discipline_level_id);
create index if not exists technical_evaluations_student_fk_idx
  on public.technical_evaluations(student_id);
create index if not exists technical_evaluations_supersedes_fk_idx
  on public.technical_evaluations(supersedes_evaluation_id);
create index if not exists technical_evaluations_target_level_fk_idx
  on public.technical_evaluations(target_discipline_level_id);
create index if not exists technical_evaluations_template_version_fk_idx
  on public.technical_evaluations(template_version_id);
