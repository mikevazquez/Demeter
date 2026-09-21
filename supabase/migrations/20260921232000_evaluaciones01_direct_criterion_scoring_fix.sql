-- EVALUACIONES-01 · fix direct criterion recalculation variable binding.

create or replace function private.evaluations_recalculate(
  p_evaluation_id uuid
)
returns table (
  total_score numeric,
  automatic_outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_version public.evaluation_template_versions;
  v_incomplete boolean;
  v_mandatory_failed boolean;
  v_criterion_failed boolean;
  v_total numeric(5,2);
  v_outcome text;
begin
  select * into v_evaluation
  from public.technical_evaluations
  where id = p_evaluation_id;

  if v_evaluation.id is null then
    raise exception 'evaluation_not_found';
  end if;

  select * into v_version
  from public.evaluation_template_versions
  where id = v_evaluation.template_version_id;

  select coalesce(sum(r.weighted_points), 0)
    into v_total
  from public.technical_evaluation_criterion_results r
  join public.evaluation_template_criteria c
    on c.id = r.template_criterion_id
   and c.template_version_id = v_evaluation.template_version_id
  where r.evaluation_id = p_evaluation_id
    and r.captured_at is not null;

  v_incomplete := private.evaluations_capture_incomplete(p_evaluation_id);

  select exists (
    select 1
    from public.evaluation_template_elements te
    join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and te.mandatory
      and er.result_status = 'does_not_meet'
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and tc.mandatory
      and cr.result_status = 'does_not_meet'
  )
  into v_mandatory_failed;

  select exists (
    select 1
    from public.evaluation_template_criteria c
    left join public.technical_evaluation_criterion_results r
      on r.template_criterion_id = c.id
     and r.evaluation_id = p_evaluation_id
    where c.template_version_id = v_evaluation.template_version_id
      and r.captured_at is not null
      and not r.passed
  )
  into v_criterion_failed;

  v_outcome :=
    case
      when v_incomplete then 'incomplete'
      when v_mandatory_failed then 'stays'
      when v_criterion_failed then 'stays'
      when v_total < v_version.pass_threshold then 'stays'
      else 'approved'
    end;

  update public.technical_evaluations
  set
    automatic_outcome = v_outcome,
    total_score = v_total,
    updated_at = now(),
    last_saved_at = now()
  where id = p_evaluation_id;

  total_score := v_total;
  automatic_outcome := v_outcome;
  return next;
end;
$$;
