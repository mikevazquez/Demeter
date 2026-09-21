
-- EVALUACIONES-01 · Sanitized student portal read models.

create or replace function public.student_evaluations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then
    raise exception 'student_context_not_found';
  end if;

  if not private.has_capability(v_student.studio_id, 'student.portal') then
    raise exception 'forbidden';
  end if;

  with active_links as (
    select
      dl.id,
      dl.discipline_id,
      dl.technical_level_id,
      dl.discipline_order,
      ld.title
    from public.discipline_technical_levels dl
    join public.technical_level_definitions ld
      on ld.id = dl.technical_level_id
     and ld.studio_id = dl.studio_id
    where dl.studio_id = v_student.studio_id
      and dl.active = true
      and ld.active = true
  ),
  current_levels as (
    select
      d.id as discipline_id,
      coalesce(sdl.discipline_technical_level_id, first_level.id) as discipline_level_id,
      coalesce(current_level.title, first_level.title) as level_title
    from public.disciplines d
    left join public.student_discipline_levels sdl
      on sdl.studio_id = d.studio_id
     and sdl.student_id = v_student.id
     and sdl.discipline_id = d.id
    left join active_links current_level
      on current_level.id = sdl.discipline_technical_level_id
    left join lateral (
      select al.id, al.title
      from active_links al
      where al.discipline_id = d.id
      order by al.discipline_order
      limit 1
    ) first_level on true
    where d.studio_id = v_student.studio_id
      and d.active = true
      and exists (
        select 1 from active_links al where al.discipline_id = d.id
      )
  ),
  open_invites as (
    select distinct on (ei.discipline_id)
      ei.*
    from public.evaluation_invitations ei
    where ei.studio_id = v_student.studio_id
      and ei.student_id = v_student.id
      and ei.status in ('offered','pending_schedule','scheduled','in_progress')
    order by ei.discipline_id, ei.created_at desc
  ),
  cycle_rows as (
    select c.*
    from public.student_evaluation_cycles c
    where c.studio_id = v_student.studio_id
      and c.student_id = v_student.id
      and c.active = true
  ),
  latest_results as (
    select distinct on (e.discipline_id)
      e.*
    from public.technical_evaluations e
    where e.studio_id = v_student.studio_id
      and e.student_id = v_student.id
      and e.status = 'published'
    order by e.discipline_id, e.evaluation_date desc, e.published_at desc
  ),
  discipline_cards as (
    select
      d.name as discipline_name,
      cl.discipline_id,
      cl.discipline_level_id,
      cl.level_title as current_level_title,
      c.id as cycle_id,
      c.cadence_months,
      c.next_due_on,
      i.id as invitation_id,
      i.invitation_kind,
      i.status as invitation_status,
      i.window_start,
      i.window_end,
      i.reservation_id,
      cs.starts_at as scheduled_starts_at,
      lr.id as latest_evaluation_id,
      lr.evaluation_date as latest_evaluation_date,
      lr.final_outcome as latest_outcome,
      lr.total_score as latest_score
    from current_levels cl
    join public.disciplines d on d.id = cl.discipline_id
    left join cycle_rows c on c.discipline_id = cl.discipline_id
    left join open_invites i on i.discipline_id = cl.discipline_id
    left join public.reservations r on r.id = i.reservation_id
    left join public.class_sessions cs on cs.id = r.session_id
    left join latest_results lr on lr.discipline_id = cl.discipline_id
  ),
  history_rows as (
    select
      e.id,
      e.discipline_id,
      d.name as discipline_name,
      e.target_discipline_level_id,
      target_level.title as evaluated_level_title,
      e.resulting_discipline_level_id,
      resulting_level.title as resulting_level_title,
      e.evaluation_date,
      e.total_score,
      e.final_outcome,
      e.published_at
    from public.technical_evaluations e
    join public.disciplines d on d.id = e.discipline_id
    left join active_links target_level on target_level.id = e.target_discipline_level_id
    left join active_links resulting_level on resulting_level.id = e.resulting_discipline_level_id
    where e.studio_id = v_student.studio_id
      and e.student_id = v_student.id
      and e.status = 'published'
    order by e.evaluation_date desc, e.published_at desc
  )
  select jsonb_build_object(
    'disciplines',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'discipline_id', dc.discipline_id,
            'discipline_name', dc.discipline_name,
            'discipline_level_id', dc.discipline_level_id,
            'current_level_title', dc.current_level_title,
            'cycle_id', dc.cycle_id,
            'cadence_months', dc.cadence_months,
            'next_due_on', dc.next_due_on,
            'invitation_id', dc.invitation_id,
            'invitation_kind', dc.invitation_kind,
            'invitation_status', dc.invitation_status,
            'window_start', dc.window_start,
            'window_end', dc.window_end,
            'reservation_id', dc.reservation_id,
            'scheduled_starts_at', dc.scheduled_starts_at,
            'latest_evaluation_id', dc.latest_evaluation_id,
            'latest_evaluation_date', dc.latest_evaluation_date,
            'latest_outcome', dc.latest_outcome,
            'latest_score', dc.latest_score
          )
          order by dc.discipline_name
        )
        from discipline_cards dc
      ),
      '[]'::jsonb
    ),
    'history',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', hr.id,
            'discipline_id', hr.discipline_id,
            'discipline_name', hr.discipline_name,
            'evaluated_level_title', hr.evaluated_level_title,
            'resulting_level_title', hr.resulting_level_title,
            'evaluation_date', hr.evaluation_date,
            'total_score', hr.total_score,
            'final_outcome', hr.final_outcome,
            'published_at', hr.published_at
          )
          order by hr.evaluation_date desc, hr.published_at desc
        )
        from history_rows hr
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.student_evaluation_invitation_detail(
  p_invitation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then
    raise exception 'student_context_not_found';
  end if;

  select jsonb_build_object(
    'id', ei.id,
    'student_id', ei.student_id,
    'discipline_id', ei.discipline_id,
    'discipline_name', d.name,
    'discipline_level_id', ei.discipline_level_id,
    'level_title', ld.title,
    'invitation_kind', ei.invitation_kind,
    'status', ei.status,
    'window_start', ei.window_start,
    'window_end', ei.window_end,
    'cadence_months', ei.cadence_months,
    'reservation_id', ei.reservation_id,
    'offered_at', ei.offered_at,
    'scheduled_at', ei.scheduled_at,
    'scheduled_starts_at', cs.starts_at
  )
  into v_result
  from public.evaluation_invitations ei
  join public.disciplines d on d.id = ei.discipline_id
  join public.discipline_technical_levels dl on dl.id = ei.discipline_level_id
  join public.technical_level_definitions ld on ld.id = dl.technical_level_id
  left join public.reservations r on r.id = ei.reservation_id
  left join public.class_sessions cs on cs.id = r.session_id
  where ei.id = p_invitation_id
    and ei.studio_id = v_student.studio_id
    and ei.student_id = v_student.id;

  if v_result is null then
    raise exception 'evaluation_invitation_not_found';
  end if;

  return v_result;
end;
$$;

create or replace function public.student_evaluation_result_detail(
  p_evaluation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then
    raise exception 'student_context_not_found';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'discipline_id', e.discipline_id,
    'discipline_name', d.name,
    'evaluated_level_title', target_def.title,
    'resulting_level_title', result_def.title,
    'evaluation_date', e.evaluation_date,
    'total_score', e.total_score,
    'final_outcome', e.final_outcome,
    'strengths', e.strengths,
    'improvement_areas', e.improvement_areas,
    'coach_message', e.coach_message,
    'next_objective', e.next_objective,
    'published_at', e.published_at,
    'next_due_on', c.next_due_on,
    'cadence_months', c.cadence_months,
    'criteria', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'label', etc.label,
            'weight_percent', etc.weight_percent,
            'min_percent', etc.min_percent,
            'score_percent', er.score_percent,
            'weighted_points', er.weighted_points,
            'passed', er.passed
          )
          order by etc.sort_order
        )
        from public.technical_evaluation_criterion_results er
        join public.evaluation_template_criteria etc
          on etc.id = er.template_criterion_id
        where er.evaluation_id = e.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.technical_evaluations e
  join public.disciplines d on d.id = e.discipline_id
  join public.discipline_technical_levels target_dl on target_dl.id = e.target_discipline_level_id
  join public.technical_level_definitions target_def on target_def.id = target_dl.technical_level_id
  left join public.discipline_technical_levels result_dl
    on result_dl.id = e.resulting_discipline_level_id
  left join public.technical_level_definitions result_def
    on result_def.id = result_dl.technical_level_id
  left join public.student_evaluation_cycles c
    on c.studio_id = e.studio_id
   and c.student_id = e.student_id
   and c.discipline_id = e.discipline_id
   and c.active = true
  where e.id = p_evaluation_id
    and e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published';

  if v_result is null then
    raise exception 'evaluation_result_not_found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.student_evaluations_snapshot() from public, anon;
grant execute on function public.student_evaluations_snapshot() to authenticated;

revoke all on function public.student_evaluation_invitation_detail(uuid) from public, anon;
grant execute on function public.student_evaluation_invitation_detail(uuid) to authenticated;

revoke all on function public.student_evaluation_result_detail(uuid) from public, anon;
grant execute on function public.student_evaluation_result_detail(uuid) to authenticated;
