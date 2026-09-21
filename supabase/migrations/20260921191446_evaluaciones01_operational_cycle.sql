
-- EVALUACIONES-01 · Operational invitation, scheduling and automatic cycle.

create table if not exists public.student_evaluation_cycles (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  active boolean not null default false,
  cadence_months integer not null default 3 check (cadence_months between 1 and 24),
  window_days integer not null default 8 check (window_days between 1 and 31),
  joined_at timestamptz,
  next_due_on date,
  last_evaluation_id uuid references public.technical_evaluations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, student_id, discipline_id)
);

create table if not exists public.evaluation_invitations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  discipline_level_id uuid not null references public.discipline_technical_levels(id),
  cycle_id uuid references public.student_evaluation_cycles(id) on delete set null,
  invitation_kind text not null default 'first'
    check (invitation_kind in ('first','periodic')),
  status text not null default 'offered'
    check (status in ('offered','declined','pending_schedule','scheduled','in_progress','completed','cancelled')),
  window_start date not null,
  window_end date not null,
  cadence_months integer not null default 3 check (cadence_months between 1 and 24),
  reservation_id uuid references public.reservations(id) on delete set null,
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  accepted_at timestamptz,
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end >= window_start)
);

alter table public.technical_evaluations
  add column if not exists evaluation_invitation_id uuid
    references public.evaluation_invitations(id) on delete set null;

create unique index if not exists technical_evaluations_invitation_unique
  on public.technical_evaluations(evaluation_invitation_id)
  where evaluation_invitation_id is not null;

create index if not exists evaluation_invitations_student_idx
  on public.evaluation_invitations(studio_id, student_id, discipline_id, status);

create index if not exists evaluation_invitations_window_idx
  on public.evaluation_invitations(studio_id, window_start, window_end, status);

create index if not exists student_evaluation_cycles_due_idx
  on public.student_evaluation_cycles(studio_id, active, next_due_on);

alter table public.student_evaluation_cycles enable row level security;
alter table public.evaluation_invitations enable row level security;

drop policy if exists student_evaluation_cycles_staff_or_self_read on public.student_evaluation_cycles;
create policy student_evaluation_cycles_staff_or_self_read
on public.student_evaluation_cycles
for select
using (
  private.has_capability(studio_id, 'evaluations.read')
  or private.is_current_student(student_id, studio_id)
);

drop policy if exists evaluation_invitations_staff_or_self_read on public.evaluation_invitations;
create policy evaluation_invitations_staff_or_self_read
on public.evaluation_invitations
for select
using (
  private.has_capability(studio_id, 'evaluations.read')
  or private.is_current_student(student_id, studio_id)
);

create or replace function private.evaluations_resolve_student_level(
  p_studio_id uuid,
  p_student_id uuid,
  p_discipline_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select sdl.discipline_technical_level_id
      from public.student_discipline_levels sdl
      join public.discipline_technical_levels dl
        on dl.id = sdl.discipline_technical_level_id
      where sdl.studio_id = p_studio_id
        and sdl.student_id = p_student_id
        and sdl.discipline_id = p_discipline_id
        and dl.active = true
      limit 1
    ),
    (
      select dl.id
      from public.discipline_technical_levels dl
      where dl.studio_id = p_studio_id
        and dl.discipline_id = p_discipline_id
        and dl.active = true
      order by dl.discipline_order
      limit 1
    )
  );
$$;

create or replace function private.evaluations_active_template_version(
  p_studio_id uuid,
  p_discipline_level_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.evaluation_templates t
  join public.evaluation_template_versions v on v.template_id = t.id
  where t.studio_id = p_studio_id
    and t.discipline_technical_level_id = p_discipline_level_id
    and t.archived_at is null
    and v.status = 'active'
  order by v.version_number desc
  limit 1;
$$;

create or replace function public.admin_create_evaluation_invitation(
  p_student_id uuid,
  p_discipline_id uuid,
  p_window_start date,
  p_window_end date,
  p_cadence_months integer default 3
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_level_id uuid;
  v_template_version_id uuid;
  v_invitation_id uuid;
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

  v_level_id := private.evaluations_resolve_student_level(
    v_studio_id,
    p_student_id,
    p_discipline_id
  );

  if v_level_id is null then
    raise exception 'evaluation_level_not_available';
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
      'window_start', p_window_start,
      'window_end', p_window_end,
      'cadence_months', p_cadence_months,
      'first_invitation', true
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
set search_path = ''
as $$
declare
  v_invitation public.evaluation_invitations;
  v_student public.students;
  v_cycle_id uuid;
  v_window_days integer;
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

  insert into public.student_evaluation_cycles (
    studio_id,
    student_id,
    discipline_id,
    active,
    cadence_months,
    window_days,
    joined_at
  )
  values (
    v_invitation.studio_id,
    v_invitation.student_id,
    v_invitation.discipline_id,
    true,
    v_invitation.cadence_months,
    v_window_days,
    now()
  )
  on conflict (studio_id, student_id, discipline_id)
  do update set
    active = true,
    cadence_months = excluded.cadence_months,
    window_days = excluded.window_days,
    joined_at = coalesce(public.student_evaluation_cycles.joined_at, excluded.joined_at),
    updated_at = now()
  returning id into v_cycle_id;

  update public.evaluation_invitations
  set status = 'pending_schedule',
      cycle_id = v_cycle_id,
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
      'cycle_id', v_cycle_id
    )
  );

  return jsonb_build_object('ok', true, 'status', 'pending_schedule', 'cycle_id', v_cycle_id);
end;
$$;

create or replace function public.student_schedule_evaluation(
  p_invitation_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.evaluation_invitations;
  v_student public.students;
  v_session public.class_sessions;
  v_session_date date;
  v_session_discipline_id uuid;
  v_booking jsonb;
  v_reservation_id uuid;
  v_timezone text;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select * into v_invitation
  from public.evaluation_invitations
  where id = p_invitation_id
  for update;

  if v_invitation.id is null then raise exception 'evaluation_invitation_not_found'; end if;
  if v_invitation.status <> 'pending_schedule' then
    raise exception 'evaluation_invitation_not_schedulable';
  end if;

  select * into v_student
  from public.students s
  where s.id = v_invitation.student_id
    and s.studio_id = v_invitation.studio_id
    and s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student.id is null then raise exception 'forbidden'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id = p_session_id
    and cs.studio_id = v_invitation.studio_id
    and cs.status = 'scheduled';

  if v_session.id is null then raise exception 'session_not_found'; end if;

  select ct.discipline_id into v_session_discipline_id
  from public.class_templates ct
  where ct.id = v_session.template_id;

  if v_session_discipline_id <> v_invitation.discipline_id then
    raise exception 'evaluation_session_wrong_discipline';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_invitation.studio_id;

  v_session_date := (v_session.starts_at at time zone v_timezone)::date;

  if v_session_date < v_invitation.window_start
     or v_session_date > v_invitation.window_end then
    raise exception 'evaluation_session_outside_window';
  end if;

  select r.id into v_reservation_id
  from public.reservations r
  where r.studio_id = v_invitation.studio_id
    and r.student_id = v_invitation.student_id
    and r.session_id = p_session_id
    and r.status in ('reserved','attended')
  order by r.booked_at desc
  limit 1;

  if v_reservation_id is null then
    v_booking := public.student_book_session(p_session_id);

    if not coalesce((v_booking->>'eligible')::boolean, false)
       or nullif(v_booking->>'reservation_id', '') is null then
      return coalesce(v_booking, '{}'::jsonb)
        || jsonb_build_object(
          'evaluation_invitation_id', v_invitation.id,
          'evaluation_status', 'pending_schedule'
        );
    end if;

    v_reservation_id := (v_booking->>'reservation_id')::uuid;
  else
    v_booking := jsonb_build_object(
      'eligible', true,
      'reason_code', null,
      'reservation_id', v_reservation_id,
      'already_reserved', true
    );
  end if;

  update public.evaluation_invitations
  set status = 'scheduled',
      reservation_id = v_reservation_id,
      scheduled_at = now(),
      updated_at = now()
  where id = v_invitation.id;

  perform public.emit_domain_event(
    v_invitation.studio_id,
    'evaluation.scheduled',
    'evaluation_invitation',
    v_invitation.id,
    'evaluation.scheduled:' || v_invitation.id::text || ':' || v_reservation_id::text,
    now(),
    auth.uid(),
    jsonb_build_object(
      'student_id', v_invitation.student_id,
      'discipline_id', v_invitation.discipline_id,
      'reservation_id', v_reservation_id,
      'session_id', p_session_id,
      'starts_at', v_session.starts_at
    )
  );

  return v_booking
    || jsonb_build_object(
      'evaluation_invitation_id', v_invitation.id,
      'evaluation_status', 'scheduled'
    );
end;
$$;

create or replace function private.sync_evaluation_invitation_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('cancelled','no_show')
     and old.status::text is distinct from new.status::text then
    update public.evaluation_invitations
    set status = 'pending_schedule',
        reservation_id = null,
        scheduled_at = null,
        updated_at = now()
    where reservation_id = new.id
      and status = 'scheduled';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_sync_evaluation_invitation on public.reservations;
create trigger reservations_sync_evaluation_invitation
after update of status on public.reservations
for each row
execute function private.sync_evaluation_invitation_from_reservation();

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
      'template_version_id', p_template_version_id
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
set search_path = ''
as $$
declare
  v_evaluation public.technical_evaluations;
  v_auto_outcome text;
  v_total numeric;
  v_resulting_level uuid;
  v_result public.technical_evaluations;
  v_cycle public.student_evaluation_cycles;
  v_next_due date;
begin
  v_evaluation := private.evaluations_assert_draft(p_evaluation_id);

  select r.total_score, r.automatic_outcome
    into v_total, v_auto_outcome
  from private.evaluations_recalculate(p_evaluation_id) r;

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
    and c.active = true
  limit 1
  for update;

  if v_cycle.id is not null then
    v_next_due := (
      v_result.evaluation_date::timestamp
      + make_interval(months => v_cycle.cadence_months)
    )::date;

    update public.student_evaluation_cycles
    set last_evaluation_id = v_result.id,
        next_due_on = v_next_due,
        updated_at = now()
    where id = v_cycle.id;
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

create or replace function public.system_generate_due_evaluation_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.student_evaluation_cycles;
  v_level_id uuid;
  v_local_today date;
  v_invitation_id uuid;
  v_created integer := 0;
begin
  for v_cycle in
    select c.*
    from public.student_evaluation_cycles c
    where c.active = true
      and c.next_due_on is not null
  loop
    select (now() at time zone coalesce(s.timezone, 'America/Mexico_City'))::date
      into v_local_today
    from public.studios s
    where s.id = v_cycle.studio_id;

    if v_cycle.next_due_on > v_local_today then
      continue;
    end if;

    if exists (
      select 1
      from public.evaluation_invitations ei
      where ei.cycle_id = v_cycle.id
        and ei.status in ('pending_schedule','scheduled','in_progress')
    ) then
      continue;
    end if;

    v_level_id := private.evaluations_resolve_student_level(
      v_cycle.studio_id,
      v_cycle.student_id,
      v_cycle.discipline_id
    );

    if v_level_id is null
       or private.evaluations_active_template_version(v_cycle.studio_id, v_level_id) is null then
      continue;
    end if;

    insert into public.evaluation_invitations (
      studio_id,
      student_id,
      discipline_id,
      discipline_level_id,
      cycle_id,
      invitation_kind,
      status,
      window_start,
      window_end,
      cadence_months,
      offered_at
    )
    values (
      v_cycle.studio_id,
      v_cycle.student_id,
      v_cycle.discipline_id,
      v_level_id,
      v_cycle.id,
      'periodic',
      'pending_schedule',
      v_cycle.next_due_on,
      v_cycle.next_due_on + (v_cycle.window_days - 1),
      v_cycle.cadence_months,
      now()
    )
    returning id into v_invitation_id;

    perform public.emit_domain_event(
      v_cycle.studio_id,
      'evaluation.periodic.available',
      'evaluation_invitation',
      v_invitation_id,
      'evaluation.periodic.available:' || v_cycle.id::text || ':' || v_cycle.next_due_on::text,
      now(),
      null,
      jsonb_build_object(
        'student_id', v_cycle.student_id,
        'discipline_id', v_cycle.discipline_id,
        'discipline_level_id', v_level_id,
        'window_start', v_cycle.next_due_on,
        'window_end', v_cycle.next_due_on + (v_cycle.window_days - 1),
        'mandatory', true
      )
    );

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.admin_create_evaluation_invitation(uuid,uuid,date,date,integer) from public, anon;
grant execute on function public.admin_create_evaluation_invitation(uuid,uuid,date,date,integer) to authenticated;

revoke all on function public.student_respond_evaluation_invitation(uuid,boolean) from public, anon;
grant execute on function public.student_respond_evaluation_invitation(uuid,boolean) to authenticated;

revoke all on function public.student_schedule_evaluation(uuid,uuid) from public, anon;
grant execute on function public.student_schedule_evaluation(uuid,uuid) to authenticated;

revoke all on function public.admin_start_scheduled_evaluation(uuid) from public, anon;
grant execute on function public.admin_start_scheduled_evaluation(uuid) to authenticated;

revoke all on function public.system_generate_due_evaluation_invitations() from public, anon, authenticated;
grant execute on function public.system_generate_due_evaluation_invitations() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'studio_flow_due_evaluations'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'studio_flow_due_evaluations',
    '0 14 * * *',
    'select public.system_generate_due_evaluation_invitations();'
  );
end;
$$;
