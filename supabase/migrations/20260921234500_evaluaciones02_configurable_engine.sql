-- EVALUACIONES v2 · configurable block engine, placement and progression semantics.
-- Sandbox-first. Keeps legacy schema_version=1 evaluations readable and immutable.

alter table public.evaluation_template_versions
  add column if not exists schema_version smallint not null default 1
    check (schema_version in (1, 2));

alter table public.evaluation_template_criteria
  add column if not exists block_type text not null default 'direct_score'
    check (block_type in ('direct_score','weighted_criteria','element_list','correct_incorrect','meets')),
  add column if not exists progression_required boolean not null default false,
  add column if not exists evaluator_instructions text;

alter table public.evaluation_template_elements
  add column if not exists item_label text,
  add column if not exists item_description text,
  add column if not exists item_kind text not null default 'element'
    check (item_kind in ('criterion','element','question')),
  add column if not exists item_weight_percent numeric(5,2)
    check (item_weight_percent is null or (item_weight_percent >= 0 and item_weight_percent <= 100)),
  add column if not exists progression_required boolean not null default false;

alter table public.evaluation_invitations
  add column if not exists evaluation_purpose text not null default 'progression'
    check (evaluation_purpose in ('placement','progression','exception'));

alter table public.technical_evaluations
  add column if not exists evaluation_purpose text not null default 'progression'
    check (evaluation_purpose in ('placement','progression','exception'));

create index if not exists evaluation_template_criteria_v2_idx
  on public.evaluation_template_criteria(template_version_id, sort_order, block_type);

create index if not exists evaluation_template_elements_v2_idx
  on public.evaluation_template_elements(template_version_id, criterion_id, sort_order);

create or replace function public.admin_create_evaluation_invitation_v2(
  p_student_id uuid,
  p_discipline_id uuid,
  p_window_start date,
  p_window_end date,
  p_cadence_months integer default 3,
  p_discipline_level_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_current_level_id uuid;
  v_level_id uuid;
  v_template_version_id uuid;
  v_invitation_id uuid;
  v_purpose text;
begin
  select s.studio_id into v_studio_id
  from public.students s
  where s.id = p_student_id;

  if v_studio_id is null then
    raise exception 'evaluation_student_not_found';
  end if;

  perform private.evaluations_require_capability(v_studio_id, 'evaluations.write');

  if p_window_start is null
     or p_window_end is null
     or p_window_end < p_window_start
     or (p_window_end - p_window_start) > 30 then
    raise exception 'evaluation_invitation_window_invalid';
  end if;

  if p_cadence_months is null or p_cadence_months < 1 or p_cadence_months > 24 then
    raise exception 'evaluation_invitation_cadence_invalid';
  end if;

  if not exists (
    select 1
    from public.disciplines d
    where d.id = p_discipline_id
      and d.studio_id = v_studio_id
      and d.active = true
  ) then
    raise exception 'evaluation_discipline_not_found';
  end if;

  if exists (
    select 1
    from public.evaluation_invitations ei
    where ei.studio_id = v_studio_id
      and ei.student_id = p_student_id
      and ei.discipline_id = p_discipline_id
      and ei.status in ('offered','pending_schedule','scheduled','in_progress')
  ) then
    raise exception 'evaluation_invitation_already_open';
  end if;

  select sdl.discipline_technical_level_id
    into v_current_level_id
  from public.student_discipline_levels sdl
  where sdl.studio_id = v_studio_id
    and sdl.student_id = p_student_id
    and sdl.discipline_id = p_discipline_id
  limit 1;

  if v_current_level_id is null then
    if p_discipline_level_id is null then
      raise exception 'evaluation_placement_level_required';
    end if;

    select dl.id into v_level_id
    from public.discipline_technical_levels dl
    where dl.id = p_discipline_level_id
      and dl.studio_id = v_studio_id
      and dl.discipline_id = p_discipline_id
      and dl.active = true;

    if v_level_id is null then
      raise exception 'evaluation_level_not_available';
    end if;

    v_purpose := 'placement';
  else
    v_level_id := v_current_level_id;
    v_purpose := 'progression';

    if p_discipline_level_id is not null and p_discipline_level_id <> v_current_level_id then
      raise exception 'evaluation_level_mismatch';
    end if;
  end if;

  v_template_version_id := private.evaluations_active_template_version(
    v_studio_id,
    v_level_id
  );

  if v_template_version_id is null then
    raise exception 'evaluation_level_not_configured';
  end if;

  insert into public.evaluation_invitations (
    studio_id,
    student_id,
    discipline_id,
    discipline_level_id,
    invitation_kind,
    evaluation_purpose,
    status,
    window_start,
    window_end,
    cadence_months,
    created_by
  )
  values (
    v_studio_id,
    p_student_id,
    p_discipline_id,
    v_level_id,
    'first',
    v_purpose,
    'offered',
    p_window_start,
    p_window_end,
    p_cadence_months,
    auth.uid()
  )
  returning id into v_invitation_id;

  perform public.emit_domain_event(
    v_studio_id,
    'evaluation.invitation.offered',
    'evaluation_invitation',
    v_invitation_id,
    'evaluation.invitation.offered:' || v_invitation_id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', p_student_id,
      'discipline_id', p_discipline_id,
      'discipline_level_id', v_level_id,
      'evaluation_purpose', v_purpose,
      'window_start', p_window_start,
      'window_end', p_window_end,
      'cadence_months', p_cadence_months,
      'first_invitation', true
    )
  );

  return v_invitation_id;
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
  v_current_level_id uuid;
  v_evaluator_name text;
  v_evaluation_id uuid;
  v_purpose text;
begin
  select s.studio_id, s.full_name
    into v_studio_id, v_student_name
  from public.students s
  where s.id = p_student_id;

  if v_studio_id is null then
    raise exception 'evaluation_student_not_found';
  end if;

  perform private.evaluations_require_capability(v_studio_id, 'evaluations.write');

  select sdl.discipline_technical_level_id
    into v_current_level_id
  from public.student_discipline_levels sdl
  where sdl.studio_id = v_studio_id
    and sdl.student_id = p_student_id
    and sdl.discipline_id = p_discipline_id
  limit 1;

  v_purpose := case when v_current_level_id is null then 'placement' else 'progression' end;

  select p.full_name
    into v_evaluator_name
  from public.profiles p
  where p.id = p_evaluator_user_id;

  insert into public.technical_evaluations (
    studio_id,
    student_id,
    student_name_snapshot,
    discipline_id,
    current_discipline_level_id_at_start,
    target_discipline_level_id,
    template_version_id,
    evaluation_purpose,
    evaluator_user_id,
    evaluator_name_snapshot,
    evaluation_date,
    created_by
  )
  values (
    v_studio_id,
    p_student_id,
    v_student_name,
    p_discipline_id,
    v_current_level_id,
    p_target_discipline_level_id,
    p_template_version_id,
    v_purpose,
    p_evaluator_user_id,
    v_evaluator_name,
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
      'template_version_id', p_template_version_id,
      'evaluation_purpose', v_purpose
    )
  );

  return v_evaluation_id;
end;
$$;

create or replace function public.admin_start_scheduled_evaluation(
  p_invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.evaluation_invitations;
  v_reservation public.reservations;
  v_session public.class_sessions;
  v_template_version_id uuid;
  v_evaluation_id uuid;
  v_timezone text;
  v_evaluation_date date;
begin
  select * into v_invitation
  from public.evaluation_invitations
  where id = p_invitation_id
  for update;

  if v_invitation.id is null then raise exception 'evaluation_invitation_not_found'; end if;

  perform private.evaluations_require_capability(v_invitation.studio_id, 'evaluations.write');

  select te.id into v_evaluation_id
  from public.technical_evaluations te
  where te.evaluation_invitation_id = v_invitation.id
  limit 1;

  if v_evaluation_id is not null then
    return v_evaluation_id;
  end if;

  if v_invitation.status <> 'scheduled' or v_invitation.reservation_id is null then
    raise exception 'evaluation_not_scheduled';
  end if;

  select * into v_reservation
  from public.reservations r
  where r.id = v_invitation.reservation_id
    and r.student_id = v_invitation.student_id
    and r.status in ('reserved','attended');

  if v_reservation.id is null then raise exception 'evaluation_reservation_not_active'; end if;

  select * into v_session
  from public.class_sessions cs
  where cs.id = v_reservation.session_id;

  if v_session.id is null then raise exception 'session_not_found'; end if;

  v_template_version_id := private.evaluations_active_template_version(
    v_invitation.studio_id,
    v_invitation.discipline_level_id
  );

  if v_template_version_id is null then raise exception 'evaluation_level_not_configured'; end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_invitation.studio_id;

  v_evaluation_date := (v_session.starts_at at time zone v_timezone)::date;

  v_evaluation_id := public.admin_create_technical_evaluation(
    v_invitation.student_id,
    v_invitation.discipline_id,
    v_invitation.discipline_level_id,
    v_template_version_id,
    v_evaluation_date,
    auth.uid()
  );

  update public.technical_evaluations
  set evaluation_invitation_id = v_invitation.id,
      evaluation_purpose = v_invitation.evaluation_purpose,
      updated_at = now()
  where id = v_evaluation_id;

  update public.evaluation_invitations
  set status = 'in_progress',
      updated_at = now()
  where id = v_invitation.id;

  perform public.emit_domain_event(
    v_invitation.studio_id,
    'evaluation.started',
    'evaluation_invitation',
    v_invitation.id,
    'evaluation.started:' || v_invitation.id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', v_invitation.student_id,
      'discipline_id', v_invitation.discipline_id,
      'evaluation_id', v_evaluation_id,
      'evaluation_purpose', v_invitation.evaluation_purpose,
      'reservation_id', v_invitation.reservation_id
    )
  );

  return v_evaluation_id;
end;
$$;

create or replace function private.evaluations_recalculate_v2(
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
  v_block public.evaluation_template_criteria;
  v_block_count integer := 0;
  v_item_count integer;
  v_missing integer;
  v_weight_total numeric := 0;
  v_item_weight_total numeric;
  v_block_score numeric := 0;
  v_weighted numeric := 0;
  v_total numeric := 0;
  v_incomplete boolean := false;
  v_progression_failed boolean := false;
  v_block_failed boolean := false;
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

  if v_version.id is null or v_version.schema_version <> 2 then
    raise exception 'evaluation_not_v2';
  end if;

  for v_block in
    select *
    from public.evaluation_template_criteria
    where template_version_id = v_evaluation.template_version_id
    order by sort_order
  loop
    v_block_count := v_block_count + 1;
    v_weight_total := v_weight_total + v_block.weight_percent;
    v_block_score := 0;

    if v_block.block_type = 'direct_score' then
      select
        case when r.captured_at is null then 1 else 0 end,
        coalesce(r.score_percent, 0)
      into v_missing, v_block_score
      from (select 1) seed
      left join public.technical_evaluation_criterion_results r
        on r.evaluation_id = p_evaluation_id
       and r.template_criterion_id = v_block.id;

      if coalesce(v_missing, 1) > 0 then
        v_incomplete := true;
      end if;
    else
      select count(*)
        into v_item_count
      from public.evaluation_template_elements te
      where te.template_version_id = v_evaluation.template_version_id
        and te.criterion_id = v_block.id;

      if v_item_count = 0 then
        v_incomplete := true;
        v_block_score := 0;
      else
        select count(*)
          into v_missing
        from public.evaluation_template_elements te
        left join public.technical_evaluation_element_results er
          on er.template_element_id = te.id
         and er.evaluation_id = p_evaluation_id
        where te.template_version_id = v_evaluation.template_version_id
          and te.criterion_id = v_block.id
          and (
            coalesce(er.result_status, 'not_evaluated') = 'not_evaluated'
            or (te.scored and er.score is null)
          );

        if v_missing > 0 then
          v_incomplete := true;
        end if;

        select coalesce(sum(te.item_weight_percent), 0)
          into v_item_weight_total
        from public.evaluation_template_elements te
        where te.template_version_id = v_evaluation.template_version_id
          and te.criterion_id = v_block.id
          and te.item_weight_percent is not null;

        if v_item_weight_total > 0 and abs(v_item_weight_total - 100) > 0.01 then
          v_incomplete := true;
        end if;

        select coalesce(
          sum(
            (
              case
                when te.scored and er.score is not null
                  then least((er.score / nullif(te.max_score, 0)) * 100, 100)
                when er.result_status = 'meets' then 100
                when er.result_status = 'does_not_meet' then 0
                else 0
              end
            )
            *
            (
              case
                when v_item_weight_total > 0 then coalesce(te.item_weight_percent, 0) / 100.0
                else 1.0 / nullif(v_item_count, 0)
              end
            )
          ),
          0
        )
        into v_block_score
        from public.evaluation_template_elements te
        left join public.technical_evaluation_element_results er
          on er.template_element_id = te.id
         and er.evaluation_id = p_evaluation_id
        where te.template_version_id = v_evaluation.template_version_id
          and te.criterion_id = v_block.id;

        if exists (
          select 1
          from public.evaluation_template_elements te
          left join public.technical_evaluation_element_results er
            on er.template_element_id = te.id
           and er.evaluation_id = p_evaluation_id
          where te.template_version_id = v_evaluation.template_version_id
            and te.criterion_id = v_block.id
            and (te.progression_required or te.mandatory)
            and (
              coalesce(er.result_status, 'not_evaluated') <> 'meets'
              or (
                te.scored
                and te.min_score is not null
                and coalesce(er.score, -1) < te.min_score
              )
            )
        ) then
          v_progression_failed := true;
        end if;
      end if;
    end if;

    if v_block.progression_required
       and v_block.min_percent is not null
       and v_block_score < v_block.min_percent then
      v_progression_failed := true;
    end if;

    if v_block.min_percent is not null and v_block_score < v_block.min_percent then
      v_block_failed := true;
    end if;

    v_weighted := round((v_block_score * v_block.weight_percent) / 100.0, 2);
    v_total := v_total + v_weighted;

    insert into public.technical_evaluation_criterion_results (
      studio_id,
      evaluation_id,
      template_criterion_id,
      score_percent,
      weighted_points,
      passed,
      notes,
      captured_at,
      updated_at
    )
    values (
      v_evaluation.studio_id,
      p_evaluation_id,
      v_block.id,
      round(v_block_score, 2),
      v_weighted,
      (v_block.min_percent is null or v_block_score >= v_block.min_percent),
      (
        select r.notes
        from public.technical_evaluation_criterion_results r
        where r.evaluation_id = p_evaluation_id
          and r.template_criterion_id = v_block.id
      ),
      case when v_incomplete then null else now() end,
      now()
    )
    on conflict (evaluation_id, template_criterion_id)
    do update set
      score_percent = excluded.score_percent,
      weighted_points = excluded.weighted_points,
      passed = excluded.passed,
      captured_at = case
        when excluded.captured_at is null then public.technical_evaluation_criterion_results.captured_at
        else excluded.captured_at
      end,
      updated_at = now();
  end loop;

  if v_block_count = 0 or abs(v_weight_total - 100) > 0.01 then
    v_incomplete := true;
  end if;

  v_total := round(v_total, 2);

  v_outcome :=
    case
      when v_incomplete then 'incomplete'
      when v_progression_failed then 'stays'
      when v_block_failed then 'stays'
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
  v_schema_version smallint;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  select v.schema_version into v_schema_version
  from public.evaluation_template_versions v
  where v.id = v_evaluation.template_version_id;

  if coalesce(v_schema_version, 1) = 2 then
    return query
    select * from private.evaluations_recalculate_v2(p_evaluation_id);
  else
    return query
    select * from private.evaluations_recalculate(p_evaluation_id);
  end if;
end;
$$;

create or replace function public.admin_activate_evaluation_template_version_v2(
  p_template_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.evaluation_template_versions;
  v_template public.evaluation_templates;
  v_total numeric;
  v_block public.evaluation_template_criteria;
  v_item_count integer;
  v_item_weight numeric;
  v_weighted_count integer;
begin
  select * into v_version
  from public.evaluation_template_versions
  where id = p_template_version_id;

  if v_version.id is null then
    raise exception 'evaluation_template_version_not_found';
  end if;

  select * into v_template
  from public.evaluation_templates
  where id = v_version.template_id;

  perform private.evaluations_require_capability(v_version.studio_id, 'evaluations.configure');

  if v_version.schema_version <> 2 then
    raise exception 'evaluation_template_not_v2';
  end if;

  select coalesce(sum(c.weight_percent), 0)
    into v_total
  from public.evaluation_template_criteria c
  where c.template_version_id = v_version.id;

  if abs(v_total - 100) > 0.01 then
    raise exception 'evaluation_v2_block_weight_total';
  end if;

  if not exists (
    select 1 from public.evaluation_template_criteria c
    where c.template_version_id = v_version.id
  ) then
    raise exception 'evaluation_v2_blocks_required';
  end if;

  for v_block in
    select *
    from public.evaluation_template_criteria
    where template_version_id = v_version.id
  loop
    if v_block.block_type <> 'direct_score' then
      select count(*),
             count(*) filter (where te.item_weight_percent is not null),
             coalesce(sum(te.item_weight_percent), 0)
        into v_item_count, v_weighted_count, v_item_weight
      from public.evaluation_template_elements te
      where te.template_version_id = v_version.id
        and te.criterion_id = v_block.id;

      if v_item_count = 0 then
        raise exception 'evaluation_v2_block_items_required';
      end if;

      if v_block.block_type = 'weighted_criteria' then
        if v_weighted_count <> v_item_count or abs(v_item_weight - 100) > 0.01 then
          raise exception 'evaluation_v2_item_weight_total';
        end if;
      elsif v_weighted_count > 0
        and (v_weighted_count <> v_item_count or abs(v_item_weight - 100) > 0.01) then
        raise exception 'evaluation_v2_item_weight_total';
      end if;
    end if;
  end loop;

  update public.evaluation_template_versions
  set status = 'archived',
      archived_at = now(),
      updated_at = now()
  where template_id = v_version.template_id
    and id <> v_version.id
    and status = 'active';

  update public.evaluation_template_versions
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      archived_at = null,
      updated_at = now()
  where id = v_version.id;
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
  v_schema_version smallint;
  v_resulting_level uuid;
  v_result public.technical_evaluations;
  v_cycle public.student_evaluation_cycles;
  v_next_due date;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  select v.schema_version into v_schema_version
  from public.evaluation_template_versions v
  where v.id = v_evaluation.template_version_id;

  if coalesce(v_schema_version, 1) = 2 then
    select r.total_score, r.automatic_outcome
      into v_total, v_auto_outcome
    from private.evaluations_recalculate_v2(p_evaluation_id) r;
  else
    select r.total_score, r.automatic_outcome
      into v_total, v_auto_outcome
    from private.evaluations_recalculate(p_evaluation_id) r;
  end if;

  if v_auto_outcome = 'incomplete' then
    raise exception 'evaluation_incomplete';
  end if;

  if v_auto_outcome not in ('approved','stays') then
    raise exception 'evaluation_invalid_automatic_outcome';
  end if;

  if p_final_outcome is not null and p_final_outcome <> v_auto_outcome then
    raise exception 'evaluation_manual_outcome_disabled';
  end if;

  if v_auto_outcome = 'approved' then
    if v_evaluation.evaluation_purpose = 'placement' then
      v_resulting_level := v_evaluation.target_discipline_level_id;
    elsif v_evaluation.evaluation_purpose = 'progression' then
      select dl.id
        into v_resulting_level
      from public.discipline_technical_levels current_level
      join public.discipline_technical_levels dl
        on dl.studio_id = current_level.studio_id
       and dl.discipline_id = current_level.discipline_id
       and dl.active = true
       and dl.discipline_order > current_level.discipline_order
      where current_level.id = v_evaluation.target_discipline_level_id
      order by dl.discipline_order
      limit 1;

      v_resulting_level := coalesce(v_resulting_level, v_evaluation.target_discipline_level_id);
    else
      v_resulting_level := v_evaluation.target_discipline_level_id;
    end if;
  else
    if v_evaluation.evaluation_purpose = 'placement'
       and v_evaluation.current_discipline_level_id_at_start is null then
      v_resulting_level := null;
    else
      v_resulting_level := coalesce(
        v_evaluation.current_discipline_level_id_at_start,
        v_evaluation.target_discipline_level_id
      );
    end if;
  end if;

  perform set_config('app.evaluation_publish', 'on', true);

  update public.technical_evaluations
  set
    automatic_outcome = v_auto_outcome,
    final_outcome = v_auto_outcome,
    total_score = v_total,
    resulting_discipline_level_id = v_resulting_level,
    override_reason = null,
    override_by = null,
    override_at = null,
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

  if v_result.evaluation_invitation_id is not null then
    update public.evaluation_invitations
    set status = 'completed',
        completed_at = now(),
        updated_at = now()
    where id = v_result.evaluation_invitation_id;
  end if;

  select * into v_cycle
  from public.student_evaluation_cycles c
  where c.studio_id = v_result.studio_id
    and c.student_id = v_result.student_id
    and c.discipline_id = v_result.discipline_id
  limit 1
  for update;

  if v_cycle.id is not null then
    if v_result.evaluation_purpose = 'placement' and v_auto_outcome <> 'approved' then
      update public.student_evaluation_cycles
      set active = false,
          last_evaluation_id = v_result.id,
          next_due_on = null,
          updated_at = now()
      where id = v_cycle.id;
    else
      v_next_due := (
        v_result.evaluation_date::timestamp
        + make_interval(months => v_cycle.cadence_months)
      )::date;

      update public.student_evaluation_cycles
      set active = true,
          last_evaluation_id = v_result.id,
          next_due_on = v_next_due,
          updated_at = now()
      where id = v_cycle.id;
    end if;
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
      'final_outcome', v_auto_outcome,
      'total_score', v_total,
      'evaluation_purpose', v_result.evaluation_purpose,
      'resulting_level_id', v_resulting_level,
      'override', false
    )
  );

  perform public.emit_domain_event(
    v_result.studio_id,
    'evaluation.completed',
    'technical_evaluation',
    v_result.id,
    'evaluation.completed:' || v_result.id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', v_result.student_id,
      'discipline_id', v_result.discipline_id,
      'evaluation_purpose', v_result.evaluation_purpose,
      'evaluated_level_id', v_result.target_discipline_level_id,
      'resulting_level_id', v_resulting_level,
      'outcome', v_auto_outcome,
      'total_score', v_total,
      'next_due_on', v_next_due
    )
  );

  return v_result;
end;
$$;

revoke all on function private.evaluations_recalculate_v2(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_create_evaluation_invitation_v2(uuid,uuid,date,date,integer,uuid) from public, anon;
revoke all on function public.admin_activate_evaluation_template_version_v2(uuid) from public, anon;

grant execute on function public.admin_create_evaluation_invitation_v2(uuid,uuid,date,date,integer,uuid) to authenticated;
grant execute on function public.admin_activate_evaluation_template_version_v2(uuid) to authenticated;
