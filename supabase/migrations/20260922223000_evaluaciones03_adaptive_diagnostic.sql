-- EVALUACIONES-03 · Diagnóstico inicial adaptativo y ciclo trimestral.
-- Sandbox first. Do not promote to production without explicit approval.

alter table public.evaluation_invitations
  drop constraint if exists evaluation_invitations_evaluation_purpose_check;
alter table public.evaluation_invitations
  add constraint evaluation_invitations_evaluation_purpose_check
  check (evaluation_purpose in ('diagnostic','placement','progression','exception'));

alter table public.technical_evaluations
  drop constraint if exists technical_evaluations_evaluation_purpose_check;
alter table public.technical_evaluations
  add constraint technical_evaluations_evaluation_purpose_check
  check (evaluation_purpose in ('diagnostic','placement','progression','exception'));

create or replace function private.evaluations_first_active_level(
  p_studio_id uuid,
  p_discipline_id uuid
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select dl.id
  from public.discipline_technical_levels dl
  join public.technical_level_definitions ld
    on ld.id = dl.technical_level_id
   and ld.studio_id = dl.studio_id
  where dl.studio_id = p_studio_id
    and dl.discipline_id = p_discipline_id
    and dl.active = true
    and ld.active = true
  order by dl.discipline_order asc
  limit 1
$$;

create or replace function private.evaluations_has_confirmed_diagnostic(
  p_studio_id uuid,
  p_student_id uuid,
  p_discipline_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.technical_evaluations e
    where e.studio_id = p_studio_id
      and e.student_id = p_student_id
      and e.discipline_id = p_discipline_id
      and e.status = 'published'
      and e.evaluation_purpose in ('diagnostic','placement')
      and e.resulting_discipline_level_id is not null
  )
$$;

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
set search_path=''
as $$
declare
  v_studio_id uuid;
  v_current_level_id uuid;
  v_level_id uuid;
  v_template_version_id uuid;
  v_invitation_id uuid;
  v_purpose text;
  v_has_diagnostic boolean;
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

  v_has_diagnostic := private.evaluations_has_confirmed_diagnostic(
    v_studio_id,
    p_student_id,
    p_discipline_id
  );

  if not v_has_diagnostic then
    v_level_id := private.evaluations_first_active_level(v_studio_id, p_discipline_id);

    if v_level_id is null then
      raise exception 'evaluation_level_not_available';
    end if;

    if p_discipline_level_id is not null and p_discipline_level_id <> v_level_id then
      raise exception 'evaluation_diagnostic_level_selection_disabled';
    end if;

    v_purpose := 'diagnostic';
  else
    select sdl.discipline_technical_level_id
      into v_current_level_id
    from public.student_discipline_levels sdl
    where sdl.studio_id = v_studio_id
      and sdl.student_id = p_student_id
      and sdl.discipline_id = p_discipline_id
    limit 1;

    if v_current_level_id is null then
      raise exception 'evaluation_confirmed_level_missing';
    end if;

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
    3,
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
      'cadence_months', 3,
      'diagnostic_adaptive', (v_purpose = 'diagnostic')
    )
  );

  return v_invitation_id;
end;
$$;

create or replace function public.student_respond_evaluation_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_invitation public.evaluation_invitations;
  v_student public.students;
  v_cycle_id uuid;
  v_window_days integer;
  v_cycle_active boolean;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select * into v_invitation
  from public.evaluation_invitations
  where id = p_invitation_id
  for update;

  if v_invitation.id is null then
    raise exception 'evaluation_invitation_not_found';
  end if;

  select * into v_student
  from public.students s
  where s.id = v_invitation.student_id
    and s.studio_id = v_invitation.studio_id
    and s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student.id is null then raise exception 'forbidden'; end if;

  if v_invitation.invitation_kind <> 'first'
     or v_invitation.status <> 'offered' then
    raise exception 'evaluation_invitation_not_respondable';
  end if;

  if not p_accept then
    update public.evaluation_invitations
    set status = 'declined',
        responded_at = now(),
        updated_at = now()
    where id = v_invitation.id;

    perform public.emit_domain_event(
      v_invitation.studio_id,
      'evaluation.invitation.declined',
      'evaluation_invitation',
      v_invitation.id,
      'evaluation.invitation.declined:' || v_invitation.id::text,
      now(),
      auth.uid(),
      jsonb_build_object(
        'student_id', v_invitation.student_id,
        'discipline_id', v_invitation.discipline_id
      )
    );

    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  v_window_days := greatest(1, (v_invitation.window_end - v_invitation.window_start) + 1);
  v_cycle_active := v_invitation.evaluation_purpose <> 'diagnostic';

  insert into public.student_evaluation_cycles (
    studio_id,
    student_id,
    discipline_id,
    active,
    cadence_months,
    window_days,
    joined_at,
    next_due_on
  )
  values (
    v_invitation.studio_id,
    v_invitation.student_id,
    v_invitation.discipline_id,
    v_cycle_active,
    3,
    v_window_days,
    now(),
    null
  )
  on conflict (studio_id, student_id, discipline_id)
  do update set
    active = excluded.active,
    cadence_months = 3,
    window_days = excluded.window_days,
    joined_at = coalesce(public.student_evaluation_cycles.joined_at, excluded.joined_at),
    next_due_on = case
      when v_invitation.evaluation_purpose = 'diagnostic' then null
      else public.student_evaluation_cycles.next_due_on
    end,
    updated_at = now()
  returning id into v_cycle_id;

  update public.evaluation_invitations
  set status = 'pending_schedule',
      cycle_id = v_cycle_id,
      cadence_months = 3,
      responded_at = now(),
      accepted_at = now(),
      updated_at = now()
  where id = v_invitation.id;

  perform public.emit_domain_event(
    v_invitation.studio_id,
    'evaluation.invitation.accepted',
    'evaluation_invitation',
    v_invitation.id,
    'evaluation.invitation.accepted:' || v_invitation.id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', v_invitation.student_id,
      'discipline_id', v_invitation.discipline_id,
      'cycle_id', v_cycle_id,
      'evaluation_purpose', v_invitation.evaluation_purpose,
      'cycle_active', v_cycle_active
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'pending_schedule',
    'cycle_id', v_cycle_id,
    'evaluation_purpose', v_invitation.evaluation_purpose
  );
end;
$$;

create or replace function public.admin_start_scheduled_evaluation(
  p_invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
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
    and te.status = 'draft'
  order by te.created_at desc
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
    'evaluation.started:' || v_invitation.id::text || ':' || v_evaluation_id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', v_invitation.student_id,
      'discipline_id', v_invitation.discipline_id,
      'evaluation_id', v_evaluation_id,
      'evaluation_purpose', v_invitation.evaluation_purpose,
      'evaluated_level_id', v_invitation.discipline_level_id,
      'reservation_id', v_invitation.reservation_id
    )
  );

  return v_evaluation_id;
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
set search_path=''
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
  v_first_level uuid;
  v_next_level uuid;
  v_next_template uuid;
  v_next_evaluation_id uuid;
  v_invitation public.evaluation_invitations;
  v_window_days integer := 8;
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

  -- Adaptive initial diagnostic.
  if v_evaluation.evaluation_purpose = 'diagnostic' then
    v_first_level := private.evaluations_first_active_level(
      v_evaluation.studio_id,
      v_evaluation.discipline_id
    );

    if v_first_level is null then
      raise exception 'evaluation_level_not_available';
    end if;

    if v_auto_outcome = 'approved' then
      select next_level.id
        into v_next_level
      from public.discipline_technical_levels current_level
      join public.discipline_technical_levels next_level
        on next_level.studio_id = current_level.studio_id
       and next_level.discipline_id = current_level.discipline_id
       and next_level.active = true
       and next_level.discipline_order > current_level.discipline_order
      join public.technical_level_definitions next_def
        on next_def.id = next_level.technical_level_id
       and next_def.studio_id = next_level.studio_id
       and next_def.active = true
      where current_level.id = v_evaluation.target_discipline_level_id
      order by next_level.discipline_order
      limit 1;
    else
      v_next_level := null;
    end if;

    -- If the level was passed and another level exists, keep the same
    -- diagnostic invitation open and create the next step automatically.
    if v_auto_outcome = 'approved' and v_next_level is not null then
      v_next_template := private.evaluations_active_template_version(
        v_evaluation.studio_id,
        v_next_level
      );

      if v_next_template is null then
        raise exception 'evaluation_diagnostic_next_level_not_configured';
      end if;

      perform set_config('app.evaluation_publish', 'on', true);

      update public.technical_evaluations
      set automatic_outcome = v_auto_outcome,
          final_outcome = v_auto_outcome,
          total_score = v_total,
          resulting_discipline_level_id = null,
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

      if v_result.evaluation_invitation_id is null then
        raise exception 'evaluation_diagnostic_invitation_required';
      end if;

      update public.evaluation_invitations
      set discipline_level_id = v_next_level,
          status = 'in_progress',
          updated_at = now()
      where id = v_result.evaluation_invitation_id
      returning * into v_invitation;

      v_next_evaluation_id := public.admin_create_technical_evaluation(
        v_result.student_id,
        v_result.discipline_id,
        v_next_level,
        v_next_template,
        v_result.evaluation_date,
        coalesce(v_result.evaluator_user_id, auth.uid())
      );

      update public.technical_evaluations
      set evaluation_invitation_id = v_result.evaluation_invitation_id,
          evaluation_purpose = 'diagnostic',
          updated_at = now()
      where id = v_next_evaluation_id;

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
          'evaluation_purpose', 'diagnostic',
          'diagnostic_continues', true,
          'next_level_id', v_next_level,
          'next_evaluation_id', v_next_evaluation_id
        )
      );

      perform public.emit_domain_event(
        v_result.studio_id,
        'evaluation.diagnostic.level_passed',
        'technical_evaluation',
        v_result.id,
        'evaluation.diagnostic.level_passed:' || v_result.id::text,
        now(),
        auth.uid(),
        jsonb_build_object(
          'student_id', v_result.student_id,
          'discipline_id', v_result.discipline_id,
          'evaluated_level_id', v_result.target_discipline_level_id,
          'next_level_id', v_next_level,
          'next_evaluation_id', v_next_evaluation_id,
          'total_score', v_total
        )
      );

      return v_result;
    end if;

    -- Diagnostic stops: highest demonstrated level becomes final.
    if v_auto_outcome = 'approved' then
      v_resulting_level := v_evaluation.target_discipline_level_id;
    else
      select e.target_discipline_level_id
        into v_resulting_level
      from public.technical_evaluations e
      join public.discipline_technical_levels dl
        on dl.id = e.target_discipline_level_id
      where e.evaluation_invitation_id = v_evaluation.evaluation_invitation_id
        and e.id <> v_evaluation.id
        and e.evaluation_purpose = 'diagnostic'
        and e.status = 'published'
        and e.final_outcome = 'approved'
      order by dl.discipline_order desc
      limit 1;

      v_resulting_level := coalesce(v_resulting_level, v_first_level);
    end if;

    perform set_config('app.evaluation_publish', 'on', true);

    update public.technical_evaluations
    set automatic_outcome = v_auto_outcome,
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

    if v_result.evaluation_invitation_id is not null then
      select * into v_invitation
      from public.evaluation_invitations
      where id = v_result.evaluation_invitation_id
      for update;

      v_window_days := greatest(
        1,
        coalesce((v_invitation.window_end - v_invitation.window_start) + 1, 8)
      );
    end if;

    v_next_due := (
      v_result.evaluation_date::timestamp + make_interval(months => 3)
    )::date;

    insert into public.student_evaluation_cycles (
      studio_id,
      student_id,
      discipline_id,
      active,
      cadence_months,
      window_days,
      joined_at,
      next_due_on,
      last_evaluation_id
    )
    values (
      v_result.studio_id,
      v_result.student_id,
      v_result.discipline_id,
      true,
      3,
      v_window_days,
      now(),
      v_next_due,
      v_result.id
    )
    on conflict (studio_id, student_id, discipline_id)
    do update set
      active = true,
      cadence_months = 3,
      window_days = excluded.window_days,
      joined_at = coalesce(public.student_evaluation_cycles.joined_at, excluded.joined_at),
      next_due_on = excluded.next_due_on,
      last_evaluation_id = excluded.last_evaluation_id,
      updated_at = now()
    returning * into v_cycle;

    if v_result.evaluation_invitation_id is not null then
      update public.evaluation_invitations
      set status = 'completed',
          cycle_id = v_cycle.id,
          completed_at = now(),
          updated_at = now()
      where id = v_result.evaluation_invitation_id;
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
        'evaluation_purpose', 'diagnostic',
        'diagnostic_continues', false,
        'resulting_level_id', v_resulting_level,
        'next_due_on', v_next_due
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
        'evaluation_purpose', 'diagnostic',
        'evaluated_level_id', v_result.target_discipline_level_id,
        'resulting_level_id', v_resulting_level,
        'outcome', v_auto_outcome,
        'total_score', v_total,
        'next_due_on', v_next_due
      )
    );

    return v_result;
  end if;

  -- Existing progression / legacy placement flow.
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
  set automatic_outcome = v_auto_outcome,
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
        v_result.evaluation_date::timestamp + make_interval(months => 3)
      )::date;

      update public.student_evaluation_cycles
      set active = true,
          cadence_months = 3,
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

-- Students should only see a diagnostic result after the diagnostic has ended.
create or replace function public.student_evaluation_result_detail(
  p_evaluation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then raise exception 'student_context_not_found'; end if;

  select jsonb_build_object(
    'id', e.id,
    'discipline_id', e.discipline_id,
    'discipline_name', d.name,
    'evaluation_purpose', e.evaluation_purpose,
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
    'criteria', coalesce((
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
    ), '[]'::jsonb)
  )
  into v_result
  from public.technical_evaluations e
  join public.disciplines d on d.id = e.discipline_id
  join public.discipline_technical_levels target_dl on target_dl.id = e.target_discipline_level_id
  join public.technical_level_definitions target_def on target_def.id = target_dl.technical_level_id
  left join public.discipline_technical_levels result_dl on result_dl.id = e.resulting_discipline_level_id
  left join public.technical_level_definitions result_def on result_def.id = result_dl.technical_level_id
  left join public.student_evaluation_cycles c
    on c.studio_id = e.studio_id
   and c.student_id = e.student_id
   and c.discipline_id = e.discipline_id
   and c.active = true
  where e.id = p_evaluation_id
    and e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published'
    and (e.evaluation_purpose <> 'diagnostic' or e.resulting_discipline_level_id is not null);

  if v_result is null then raise exception 'evaluation_result_not_found'; end if;
  return v_result;
end;
$$;

create or replace function public.student_latest_unread_evaluation_result()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then raise exception 'student_context_not_found'; end if;
  if not private.has_capability(v_student.studio_id, 'student.portal') then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'id', e.id,
    'discipline_name', d.name,
    'evaluated_level_title', target_def.title,
    'resulting_level_title', result_def.title,
    'evaluation_purpose', e.evaluation_purpose,
    'evaluation_date', e.evaluation_date,
    'total_score', e.total_score,
    'final_outcome', e.final_outcome,
    'published_at', e.published_at
  )
  into v_result
  from public.technical_evaluations e
  join public.disciplines d on d.id = e.discipline_id
  join public.discipline_technical_levels target_dl on target_dl.id = e.target_discipline_level_id
  join public.technical_level_definitions target_def on target_def.id = target_dl.technical_level_id
  left join public.discipline_technical_levels result_dl on result_dl.id = e.resulting_discipline_level_id
  left join public.technical_level_definitions result_def on result_def.id = result_dl.technical_level_id
  where e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published'
    and (e.evaluation_purpose <> 'diagnostic' or e.resulting_discipline_level_id is not null)
    and not exists (
      select 1
      from public.student_evaluation_result_views v
      where v.student_id = e.student_id
        and v.evaluation_id = e.id
    )
  order by e.published_at desc nulls last, e.evaluation_date desc, e.created_at desc
  limit 1;

  return v_result;
end;
$$;
