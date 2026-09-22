-- EVALUACIONES-01 · criterion capture for complete technical scoring.
-- Criteria are scored directly by the coach. Technical elements/combos remain separate requirements.

alter table public.technical_evaluation_criterion_results
  add column if not exists captured_at timestamptz;

create or replace function public.admin_save_technical_criterion_result(
  p_evaluation_id uuid,
  p_template_criterion_id uuid,
  p_score_percent numeric,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_criterion public.evaluation_template_criteria;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  if p_score_percent is null or p_score_percent < 0 or p_score_percent > 100 then
    raise exception 'evaluation_criterion_score_out_of_range';
  end if;

  select *
    into v_criterion
  from public.evaluation_template_criteria
  where id = p_template_criterion_id
    and template_version_id = v_evaluation.template_version_id
    and studio_id = v_evaluation.studio_id;

  if v_criterion.id is null then
    raise exception 'evaluation_template_criterion_not_found';
  end if;

  insert into public.technical_evaluation_criterion_results (
    studio_id,
    evaluation_id,
    template_criterion_id,
    score_percent,
    weighted_points,
    passed,
    notes,
    captured_at
  )
  values (
    v_evaluation.studio_id,
    p_evaluation_id,
    p_template_criterion_id,
    round(p_score_percent, 2),
    round((p_score_percent / 100.0) * v_criterion.weight_percent, 2),
    p_score_percent >= coalesce(v_criterion.min_percent, 0),
    nullif(trim(p_notes), ''),
    now()
  )
  on conflict (evaluation_id, template_criterion_id)
  do update set
    score_percent = excluded.score_percent,
    weighted_points = excluded.weighted_points,
    passed = excluded.passed,
    notes = excluded.notes,
    captured_at = now();

  update public.technical_evaluations
  set last_saved_at = now()
  where id = p_evaluation_id;

  insert into public.technical_evaluation_events (
    studio_id,
    evaluation_id,
    event_type,
    actor_user_id,
    details
  )
  values (
    v_evaluation.studio_id,
    p_evaluation_id,
    'draft_saved',
    auth.uid(),
    jsonb_build_object('template_criterion_id', p_template_criterion_id)
  );
end;
$$;

revoke all on function public.admin_save_technical_criterion_result(uuid, uuid, numeric, text)
from public, anon;

grant execute on function public.admin_save_technical_criterion_result(uuid, uuid, numeric, text)
to authenticated;

create or replace function private.evaluations_capture_incomplete(
  p_evaluation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
begin
  select *
    into v_evaluation
  from public.technical_evaluations
  where id = p_evaluation_id;

  if v_evaluation.id is null then
    raise exception 'evaluation_not_found';
  end if;

  return exists (
    select 1
    from public.evaluation_template_criteria c
    left join public.technical_evaluation_criterion_results r
      on r.template_criterion_id = c.id
     and r.evaluation_id = p_evaluation_id
    where c.template_version_id = v_evaluation.template_version_id
      and r.captured_at is null
  )
  or exists (
    select 1
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and (
        coalesce(er.result_status, 'not_evaluated') = 'not_evaluated'
        or (te.scored and er.score is null)
      )
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and (
        coalesce(cr.result_status, 'not_evaluated') = 'not_evaluated'
        or (tc.scored and cr.score is null)
      )
  );
end;
$$;

revoke all on function private.evaluations_capture_incomplete(uuid)
from public, anon, authenticated, service_role;

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

  automatic_outcome :=
    case
      when v_incomplete then 'incomplete'
      when v_mandatory_failed then 'stays'
      when v_criterion_failed then 'stays'
      when v_total < v_version.pass_threshold then 'stays'
      else 'approved'
    end;

  total_score := v_total;

  update public.technical_evaluations
  set
    automatic_outcome = private.evaluations_recalculate.automatic_outcome,
    total_score = v_total,
    updated_at = now(),
    last_saved_at = now()
  where id = p_evaluation_id;

  return next;
end;
$$;
