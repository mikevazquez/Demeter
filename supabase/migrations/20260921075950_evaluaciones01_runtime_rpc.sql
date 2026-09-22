
-- EVALUACIONES-01 · Runtime RPCs for draft capture, calculation and publication.
-- All state changes stay tenant-scoped and capability-gated.

create or replace function private.evaluations_require_capability(
  p_studio_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_capability(p_studio_id, p_capability) then
    raise exception 'evaluation_access_denied';
  end if;
end;
$$;

create or replace function private.evaluations_assert_draft(
  p_evaluation_id uuid
)
returns public.technical_evaluations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
begin
  select * into v_evaluation
  from public.technical_evaluations
  where id = p_evaluation_id;

  if v_evaluation.id is null then
    raise exception 'evaluation_not_found';
  end if;

  perform private.evaluations_require_capability(v_evaluation.studio_id, 'evaluations.write');

  if v_evaluation.status <> 'draft' then
    raise exception 'evaluation_not_editable';
  end if;

  return v_evaluation;
end;
$$;

create or replace function public.admin_create_technical_evaluation(
  p_student_id uuid,
  p_discipline_id uuid,
  p_target_discipline_level_id uuid,
  p_template_version_id uuid,
  p_evaluation_date date default current_date,
  p_evaluator_user_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_student_name text;
  v_evaluation_id uuid;
begin
  select s.studio_id, s.full_name
    into v_studio_id, v_student_name
  from public.students s
  where s.id = p_student_id;

  if v_studio_id is null then
    raise exception 'evaluation_student_not_found';
  end if;

  perform private.evaluations_require_capability(v_studio_id, 'evaluations.write');

  insert into public.technical_evaluations (
    studio_id,
    student_id,
    student_name_snapshot,
    discipline_id,
    target_discipline_level_id,
    template_version_id,
    evaluator_user_id,
    evaluation_date,
    created_by
  )
  values (
    v_studio_id,
    p_student_id,
    v_student_name,
    p_discipline_id,
    p_target_discipline_level_id,
    p_template_version_id,
    p_evaluator_user_id,
    coalesce(p_evaluation_date, current_date),
    auth.uid()
  )
  returning id into v_evaluation_id;

  insert into public.technical_evaluation_element_results (
    studio_id,
    evaluation_id,
    template_element_id
  )
  select v_studio_id, v_evaluation_id, te.id
  from public.evaluation_template_elements te
  where te.template_version_id = p_template_version_id
  on conflict (evaluation_id, template_element_id) do nothing;

  insert into public.technical_evaluation_combo_results (
    studio_id,
    evaluation_id,
    template_combo_id
  )
  select v_studio_id, v_evaluation_id, tc.id
  from public.evaluation_template_combos tc
  where tc.template_version_id = p_template_version_id
  on conflict (evaluation_id, template_combo_id) do nothing;

  insert into public.technical_evaluation_events (
    studio_id,
    evaluation_id,
    event_type,
    actor_user_id,
    details
  )
  values (
    v_studio_id,
    v_evaluation_id,
    'created',
    auth.uid(),
    jsonb_build_object(
      'student_id', p_student_id,
      'discipline_id', p_discipline_id,
      'target_level_id', p_target_discipline_level_id,
      'template_version_id', p_template_version_id
    )
  );

  return v_evaluation_id;
end;
$$;

create or replace function public.admin_save_technical_element_result(
  p_evaluation_id uuid,
  p_template_element_id uuid,
  p_result_status text,
  p_score numeric default null,
  p_attempt_count smallint default 0,
  p_notes text default null,
  p_quick_comments text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_template_element public.evaluation_template_elements;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  if p_result_status not in ('meets', 'does_not_meet', 'not_evaluated') then
    raise exception 'evaluation_invalid_result_status';
  end if;

  select * into v_template_element
  from public.evaluation_template_elements
  where id = p_template_element_id
    and template_version_id = v_evaluation.template_version_id
    and studio_id = v_evaluation.studio_id;

  if v_template_element.id is null then
    raise exception 'evaluation_template_element_not_found';
  end if;

  if p_score is not null and (p_score < 0 or p_score > v_template_element.max_score) then
    raise exception 'evaluation_score_out_of_range';
  end if;

  if p_attempt_count < 0
     or (coalesce(v_template_element.attempts_allowed, 0) > 0
         and p_attempt_count > v_template_element.attempts_allowed) then
    raise exception 'evaluation_attempt_count_out_of_range';
  end if;

  insert into public.technical_evaluation_element_results (
    studio_id,
    evaluation_id,
    template_element_id,
    result_status,
    score,
    attempt_count,
    notes,
    quick_comments,
    evaluated_at,
    updated_at
  )
  values (
    v_evaluation.studio_id,
    p_evaluation_id,
    p_template_element_id,
    p_result_status,
    p_score,
    p_attempt_count,
    nullif(trim(p_notes), ''),
    coalesce(p_quick_comments, '{}'::text[]),
    case when p_result_status = 'not_evaluated' then null else now() end,
    now()
  )
  on conflict (evaluation_id, template_element_id)
  do update set
    result_status = excluded.result_status,
    score = excluded.score,
    attempt_count = excluded.attempt_count,
    notes = excluded.notes,
    quick_comments = excluded.quick_comments,
    evaluated_at = excluded.evaluated_at,
    updated_at = now();

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
    jsonb_build_object('template_element_id', p_template_element_id)
  );
end;
$$;

create or replace function public.admin_save_technical_combo_result(
  p_evaluation_id uuid,
  p_template_combo_id uuid,
  p_result_status text,
  p_score numeric default null,
  p_attempt_count smallint default 0,
  p_notes text default null,
  p_quick_comments text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_template_combo public.evaluation_template_combos;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  if p_result_status not in ('meets', 'does_not_meet', 'not_evaluated') then
    raise exception 'evaluation_invalid_result_status';
  end if;

  select * into v_template_combo
  from public.evaluation_template_combos
  where id = p_template_combo_id
    and template_version_id = v_evaluation.template_version_id
    and studio_id = v_evaluation.studio_id;

  if v_template_combo.id is null then
    raise exception 'evaluation_template_combo_not_found';
  end if;

  if p_score is not null and (p_score < 0 or p_score > v_template_combo.max_score) then
    raise exception 'evaluation_score_out_of_range';
  end if;

  if p_attempt_count < 0
     or (coalesce(v_template_combo.attempts_allowed, 0) > 0
         and p_attempt_count > v_template_combo.attempts_allowed) then
    raise exception 'evaluation_attempt_count_out_of_range';
  end if;

  insert into public.technical_evaluation_combo_results (
    studio_id,
    evaluation_id,
    template_combo_id,
    result_status,
    score,
    attempt_count,
    notes,
    quick_comments,
    evaluated_at,
    updated_at
  )
  values (
    v_evaluation.studio_id,
    p_evaluation_id,
    p_template_combo_id,
    p_result_status,
    p_score,
    p_attempt_count,
    nullif(trim(p_notes), ''),
    coalesce(p_quick_comments, '{}'::text[]),
    case when p_result_status = 'not_evaluated' then null else now() end,
    now()
  )
  on conflict (evaluation_id, template_combo_id)
  do update set
    result_status = excluded.result_status,
    score = excluded.score,
    attempt_count = excluded.attempt_count,
    notes = excluded.notes,
    quick_comments = excluded.quick_comments,
    evaluated_at = excluded.evaluated_at,
    updated_at = now();

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
    jsonb_build_object('template_combo_id', p_template_combo_id)
  );
end;
$$;

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

  delete from public.technical_evaluation_criterion_results
  where evaluation_id = p_evaluation_id;

  insert into public.technical_evaluation_criterion_results (
    studio_id,
    evaluation_id,
    template_criterion_id,
    score_percent,
    weighted_points,
    passed
  )
  select
    v_evaluation.studio_id,
    p_evaluation_id,
    c.id,
    coalesce(
      round(
        (
          sum(
            case
              when x.scored and x.score is not null
                then least(x.score / nullif(x.max_score, 0), 1)
              else 0
            end
          )
          /
          nullif(sum(case when x.scored then 1 else 0 end), 0)
        ) * 100,
        2
      ),
      0
    ) as score_percent,
    round(
      coalesce(
        (
          sum(
            case
              when x.scored and x.score is not null
                then least(x.score / nullif(x.max_score, 0), 1)
              else 0
            end
          )
          /
          nullif(sum(case when x.scored then 1 else 0 end), 0)
        ),
        0
      ) * c.weight_percent,
      2
    ) as weighted_points,
    coalesce(
      (
        coalesce(
          (
            sum(
              case
                when x.scored and x.score is not null
                  then least(x.score / nullif(x.max_score, 0), 1)
                else 0
              end
            )
            /
            nullif(sum(case when x.scored then 1 else 0 end), 0)
          ),
          0
        ) * 100
      ) >= coalesce(c.min_percent, v_version.default_category_min),
      false
    ) as passed
  from public.evaluation_template_criteria c
  left join (
    select
      te.criterion_id,
      te.scored,
      te.max_score,
      er.score
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
    union all
    select
      tc.criterion_id,
      tc.scored,
      tc.max_score,
      cr.score
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
  ) x on x.criterion_id = c.id
  where c.template_version_id = v_evaluation.template_version_id
  group by c.id, c.weight_percent, c.min_percent, v_version.default_category_min;

  select coalesce(sum(r.weighted_points), 0)
    into v_total
  from public.technical_evaluation_criterion_results r
  where r.evaluation_id = p_evaluation_id;

  select exists (
    select 1
    from public.evaluation_template_elements te
    left join public.technical_evaluation_element_results er
      on er.template_element_id = te.id
     and er.evaluation_id = p_evaluation_id
    where te.template_version_id = v_evaluation.template_version_id
      and te.mandatory
      and coalesce(er.result_status, 'not_evaluated') = 'not_evaluated'
  )
  or exists (
    select 1
    from public.evaluation_template_combos tc
    left join public.technical_evaluation_combo_results cr
      on cr.template_combo_id = tc.id
     and cr.evaluation_id = p_evaluation_id
    where tc.template_version_id = v_evaluation.template_version_id
      and tc.mandatory
      and coalesce(cr.result_status, 'not_evaluated') = 'not_evaluated'
  )
  into v_incomplete;

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
    from public.technical_evaluation_criterion_results r
    where r.evaluation_id = p_evaluation_id
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

create or replace function public.admin_recalculate_technical_evaluation(
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
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  return query
  select *
  from private.evaluations_recalculate(p_evaluation_id);
end;
$$;

create or replace function public.admin_publish_technical_evaluation(
  p_evaluation_id uuid,
  p_final_outcome text default null,
  p_override_reason text default null,
  p_strengths text[] default '{}'::text[],
  p_improvement_areas text[] default '{}'::text[],
  p_coach_message text default null,
  p_next_objective text default null
)
returns public.technical_evaluations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_auto_outcome text;
  v_total numeric;
  v_final_outcome text;
  v_target_order integer;
  v_current_order integer;
  v_resulting_level uuid;
  v_result public.technical_evaluations;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  select r.total_score, r.automatic_outcome
    into v_total, v_auto_outcome
  from private.evaluations_recalculate(p_evaluation_id) r;

  v_final_outcome := coalesce(p_final_outcome, v_auto_outcome);

  if v_final_outcome not in ('approved', 'stays', 'incomplete') then
    raise exception 'evaluation_invalid_final_outcome';
  end if;

  if v_final_outcome <> v_auto_outcome and nullif(trim(p_override_reason), '') is null then
    raise exception 'evaluation_override_reason_required';
  end if;

  select dl.discipline_order
    into v_target_order
  from public.discipline_technical_levels dl
  where dl.id = v_evaluation.target_discipline_level_id;

  select dl.discipline_order
    into v_current_order
  from public.discipline_technical_levels dl
  where dl.id = v_evaluation.current_discipline_level_id_at_start;

  v_resulting_level := v_evaluation.current_discipline_level_id_at_start;

  if v_final_outcome = 'approved' then
    if v_evaluation.current_discipline_level_id_at_start is null
       or v_target_order >= coalesce(v_current_order, 0) then
      v_resulting_level := v_evaluation.target_discipline_level_id;
    end if;
  end if;

  perform set_config('app.evaluation_publish', 'on', true);

  update public.technical_evaluations
  set
    automatic_outcome = v_auto_outcome,
    final_outcome = v_final_outcome,
    total_score = v_total,
    resulting_discipline_level_id = v_resulting_level,
    override_reason = case
      when v_final_outcome <> v_auto_outcome then nullif(trim(p_override_reason), '')
      else null
    end,
    override_by = case when v_final_outcome <> v_auto_outcome then auth.uid() else null end,
    override_at = case when v_final_outcome <> v_auto_outcome then now() else null end,
    strengths = coalesce(p_strengths, '{}'::text[]),
    improvement_areas = coalesce(p_improvement_areas, '{}'::text[]),
    coach_message = nullif(trim(p_coach_message), ''),
    next_objective = nullif(trim(p_next_objective), ''),
    status = 'published',
    published_at = now(),
    updated_at = now(),
    last_saved_at = now()
  where id = p_evaluation_id
  returning * into v_result;

  if v_resulting_level is not null then
    insert into public.student_discipline_levels (
      studio_id,
      student_id,
      discipline_id,
      discipline_technical_level_id,
      effective_from,
      source_evaluation_id
    )
    values (
      v_result.studio_id,
      v_result.student_id,
      v_result.discipline_id,
      v_resulting_level,
      v_result.evaluation_date,
      v_result.id
    )
    on conflict (studio_id, student_id, discipline_id)
    do update set
      discipline_technical_level_id = excluded.discipline_technical_level_id,
      effective_from = excluded.effective_from,
      source_evaluation_id = excluded.source_evaluation_id,
      updated_at = now();
  end if;

  insert into public.technical_evaluation_events (
    studio_id,
    evaluation_id,
    event_type,
    actor_user_id,
    details
  )
  values (
    v_result.studio_id,
    v_result.id,
    'published',
    auth.uid(),
    jsonb_build_object(
      'automatic_outcome', v_auto_outcome,
      'final_outcome', v_final_outcome,
      'total_score', v_total,
      'resulting_level_id', v_resulting_level,
      'override', v_final_outcome <> v_auto_outcome
    )
  );

  if v_final_outcome <> v_auto_outcome then
    insert into public.technical_evaluation_events (
      studio_id,
      evaluation_id,
      event_type,
      actor_user_id,
      details
    )
    values (
      v_result.studio_id,
      v_result.id,
      'override_applied',
      auth.uid(),
      jsonb_build_object(
        'automatic_outcome', v_auto_outcome,
        'final_outcome', v_final_outcome,
        'reason', p_override_reason
      )
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.admin_pause_technical_evaluation(
  p_evaluation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  insert into public.technical_evaluation_events (
    studio_id,
    evaluation_id,
    event_type,
    actor_user_id
  )
  values (v_evaluation.studio_id, p_evaluation_id, 'paused', auth.uid());
end;
$$;

create or replace function public.admin_resume_technical_evaluation(
  p_evaluation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  insert into public.technical_evaluation_events (
    studio_id,
    evaluation_id,
    event_type,
    actor_user_id
  )
  values (v_evaluation.studio_id, p_evaluation_id, 'resumed', auth.uid());
end;
$$;

revoke all on function private.evaluations_require_capability(uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.evaluations_assert_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function private.evaluations_recalculate(uuid) from public, anon, authenticated, service_role;

revoke all on function public.admin_create_technical_evaluation(uuid,uuid,uuid,uuid,date,uuid) from public, anon;
revoke all on function public.admin_save_technical_element_result(uuid,uuid,text,numeric,smallint,text,text[]) from public, anon;
revoke all on function public.admin_save_technical_combo_result(uuid,uuid,text,numeric,smallint,text,text[]) from public, anon;
revoke all on function public.admin_recalculate_technical_evaluation(uuid) from public, anon;
revoke all on function public.admin_publish_technical_evaluation(uuid,text,text,text[],text[],text,text) from public, anon;
revoke all on function public.admin_pause_technical_evaluation(uuid) from public, anon;
revoke all on function public.admin_resume_technical_evaluation(uuid) from public, anon;

grant execute on function public.admin_create_technical_evaluation(uuid,uuid,uuid,uuid,date,uuid) to authenticated;
grant execute on function public.admin_save_technical_element_result(uuid,uuid,text,numeric,smallint,text,text[]) to authenticated;
grant execute on function public.admin_save_technical_combo_result(uuid,uuid,text,numeric,smallint,text,text[]) to authenticated;
grant execute on function public.admin_recalculate_technical_evaluation(uuid) to authenticated;
grant execute on function public.admin_publish_technical_evaluation(uuid,text,text,text[],text[],text,text) to authenticated;
grant execute on function public.admin_pause_technical_evaluation(uuid) to authenticated;
grant execute on function public.admin_resume_technical_evaluation(uuid) to authenticated;
