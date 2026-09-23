-- REWARDS · onboarding previo a Medalla Bronce
-- New students start without a reward-status membership. Bronze is unlocked only
-- after documents + profile + first booking + first attendance, or by audited admin exception.

create table if not exists private.reward_medal_onboarding (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  documents_completed_at timestamptz,
  documents_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(documents_evidence) = 'object'),
  profile_completed_at timestamptz,
  first_booking_at timestamptz,
  first_attendance_at timestamptz,
  bronze_unlocked_at timestamptz,
  unlock_method text check (unlock_method is null or unlock_method in ('onboarding','admin','legacy')),
  unlocked_by uuid references auth.users(id) on delete set null,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_medal_onboarding_student_unique unique (studio_id, student_id),
  constraint reward_medal_onboarding_admin_reason_chk check (
    unlock_method <> 'admin'
    or nullif(trim(coalesce(unlock_reason,'')), '') is not null
  )
);

comment on table private.reward_medal_onboarding is
  'REWARDS onboarding evidence before the first medal. Source facts remain in Documents, Profile, Reservations and Attendance.';

revoke all on table private.reward_medal_onboarding from public, anon, authenticated;

create or replace function private.reward_onboarding_profile_evidence(p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', (
      nullif(trim(coalesce(s.email,'')), '') is not null
      and s.email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    ),
    'avatar', exists (
      select 1
      from public.profiles p
      where p.id = s.user_id
        and nullif(trim(coalesce(p.avatar_url,'')), '') is not null
    ),
    'birth_date', exists (
      select 1
      from public.profile_field_definitions d
      join public.profile_field_values v
        on v.definition_id = d.id
       and v.person_id = s.person_id
       and v.studio_id = s.studio_id
      where d.studio_id = s.studio_id
        and d.entity_type = 'student'
        and d.key = 'birth_date'
        and d.active = true
        and jsonb_typeof(v.value) = 'string'
        and trim(v.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
    )
  )
  from public.students s
  where s.id = p_student_id;
$$;

revoke all on function private.reward_onboarding_profile_evidence(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_sync_student(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_row private.reward_medal_onboarding%rowtype;
  v_profile jsonb;
  v_membership public.reward_status_memberships%rowtype;
  v_timezone text;
  v_activated_on date;
  v_completed_count integer;
  v_medal_title text;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_onboarding_student_not_found';
  end if;

  insert into private.reward_medal_onboarding (studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  v_profile := private.reward_onboarding_profile_evidence(v_student.id);

  update private.reward_medal_onboarding o
  set
    profile_completed_at = case
      when o.profile_completed_at is null
       and coalesce((v_profile->>'email')::boolean,false)
       and coalesce((v_profile->>'avatar')::boolean,false)
       and coalesce((v_profile->>'birth_date')::boolean,false)
      then clock_timestamp()
      else o.profile_completed_at
    end,
    first_booking_at = coalesce(
      o.first_booking_at,
      (
        select min(r.booked_at)
        from public.reservations r
        where r.studio_id = v_student.studio_id
          and r.student_id = v_student.id
      )
    ),
    first_attendance_at = coalesce(
      o.first_attendance_at,
      (
        select min(cs.starts_at)
        from public.reservations r
        join public.class_sessions cs on cs.id = r.session_id
        where r.studio_id = v_student.studio_id
          and r.student_id = v_student.id
          and r.status = 'attended'
      )
    ),
    updated_at = clock_timestamp()
  where o.studio_id = v_student.studio_id
    and o.student_id = v_student.id
  returning * into v_row;

  select * into v_membership
  from public.reward_status_memberships m
  where m.studio_id = v_student.studio_id
    and m.student_id = v_student.id
  for update;

  if found and v_row.bronze_unlocked_at is null then
    update private.reward_medal_onboarding
    set bronze_unlocked_at = v_membership.created_at,
        unlock_method = 'legacy',
        updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_row;
  elsif not found
    and v_student.active
    and v_student.lifecycle_status = 'active'
    and v_row.documents_completed_at is not null
    and v_row.profile_completed_at is not null
    and v_row.first_booking_at is not null
    and v_row.first_attendance_at is not null
  then
    select coalesce(s.timezone, 'America/Mexico_City')
      into v_timezone
    from public.studios s
    where s.id = v_student.studio_id;

    v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

    insert into public.reward_status_memberships (
      studio_id,
      student_id,
      current_level_key,
      activated_on,
      level_effective_from
    )
    values (
      v_student.studio_id,
      v_student.id,
      'bronze',
      v_activated_on,
      date_trunc('month', v_activated_on)::date
    )
    on conflict (studio_id, student_id) do nothing
    returning * into v_membership;

    if v_membership.id is not null then
      insert into public.reward_status_events (
        studio_id,
        student_id,
        period_start,
        event_type,
        from_level_key,
        to_level_key,
        details,
        occurred_at
      )
      values (
        v_student.studio_id,
        v_student.id,
        date_trunc('month', v_activated_on)::date,
        'activated',
        null,
        'bronze',
        jsonb_build_object(
          'source', 'reward_onboarding',
          'documents_completed_at', v_row.documents_completed_at,
          'profile_completed_at', v_row.profile_completed_at,
          'first_booking_at', v_row.first_booking_at,
          'first_attendance_at', v_row.first_attendance_at
        ),
        clock_timestamp()
      );

      update private.reward_medal_onboarding
      set bronze_unlocked_at = clock_timestamp(),
          unlock_method = 'onboarding',
          updated_at = clock_timestamp()
      where id = v_row.id
      returning * into v_row;
    end if;
  end if;

  select d.title into v_medal_title
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id = m.studio_id
   and d.level_key = m.current_level_key
  where m.studio_id = v_student.studio_id
    and m.student_id = v_student.id;

  v_completed_count :=
    (case when v_row.documents_completed_at is not null then 1 else 0 end)
    + (case when v_row.profile_completed_at is not null then 1 else 0 end)
    + (case when v_row.first_booking_at is not null then 1 else 0 end)
    + (case when v_row.first_attendance_at is not null then 1 else 0 end);

  return jsonb_build_object(
    'student_id', v_student.id,
    'studio_id', v_student.studio_id,
    'status', case when v_row.bronze_unlocked_at is null then 'in_progress' else 'medal_unlocked' end,
    'completed_count', v_completed_count,
    'total_steps', 4,
    'documents', jsonb_build_object(
      'completed', v_row.documents_completed_at is not null,
      'completed_at', v_row.documents_completed_at,
      'evidence', v_row.documents_evidence
    ),
    'profile', jsonb_build_object(
      'completed', v_row.profile_completed_at is not null,
      'completed_at', v_row.profile_completed_at,
      'email', coalesce((v_profile->>'email')::boolean,false),
      'avatar', coalesce((v_profile->>'avatar')::boolean,false),
      'birth_date', coalesce((v_profile->>'birth_date')::boolean,false)
    ),
    'first_booking', jsonb_build_object(
      'completed', v_row.first_booking_at is not null,
      'completed_at', v_row.first_booking_at
    ),
    'first_attendance', jsonb_build_object(
      'completed', v_row.first_attendance_at is not null,
      'completed_at', v_row.first_attendance_at
    ),
    'medal_unlocked', v_row.bronze_unlocked_at is not null,
    'medal_key', case when v_row.bronze_unlocked_at is null then null else 'bronze' end,
    'medal_title', v_medal_title,
    'bronze_unlocked_at', v_row.bronze_unlocked_at,
    'unlock_method', v_row.unlock_method,
    'unlock_reason', v_row.unlock_reason
  );
end;
$$;

revoke all on function private.reward_onboarding_sync_student(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_mark_documents_complete(
  p_student_id uuid,
  p_completed_at timestamptz default clock_timestamp(),
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then
    raise exception 'reward_onboarding_documents_evidence_invalid';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_onboarding_student_not_found';
  end if;

  insert into private.reward_medal_onboarding (
    studio_id, student_id, documents_completed_at, documents_evidence
  )
  values (
    v_student.studio_id,
    v_student.id,
    coalesce(p_completed_at, clock_timestamp()),
    coalesce(p_evidence,'{}'::jsonb)
  )
  on conflict (studio_id, student_id)
  do update set
    documents_completed_at = coalesce(
      private.reward_medal_onboarding.documents_completed_at,
      excluded.documents_completed_at
    ),
    documents_evidence = case
      when private.reward_medal_onboarding.documents_completed_at is null
      then excluded.documents_evidence
      else private.reward_medal_onboarding.documents_evidence
    end,
    updated_at = clock_timestamp();

  return private.reward_onboarding_sync_student(v_student.id);
end;
$$;

revoke all on function private.reward_onboarding_mark_documents_complete(uuid,timestamptz,jsonb)
from public, anon, authenticated, service_role;

create or replace function public.student_reward_onboarding_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  return private.reward_onboarding_sync_student(v_student.id);
end;
$$;

revoke all on function public.student_reward_onboarding_snapshot()
from public, anon;
grant execute on function public.student_reward_onboarding_snapshot()
to authenticated;

create or replace function public.admin_reward_onboarding_snapshot(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'student_not_found';
  end if;

  if not private.has_capability(v_student.studio_id, 'rewards.read') then
    raise exception 'forbidden';
  end if;

  return private.reward_onboarding_sync_student(v_student.id);
end;
$$;

revoke all on function public.admin_reward_onboarding_snapshot(uuid)
from public, anon;
grant execute on function public.admin_reward_onboarding_snapshot(uuid)
to authenticated;

create or replace function public.admin_grant_bronze_medal(
  p_student_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_timezone text;
  v_activated_on date;
  v_reason text := nullif(trim(coalesce(p_reason,'')), '');
  v_onboarding private.reward_medal_onboarding%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;
  if v_reason is null then
    raise exception 'reward_medal_grant_reason_required';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found then
    raise exception 'student_not_found';
  end if;
  if not private.has_capability(v_student.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if exists (
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) then
    raise exception 'reward_medal_already_unlocked';
  end if;

  perform private.reward_onboarding_sync_student(v_student.id);

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_status_memberships (
    studio_id, student_id, current_level_key, activated_on, level_effective_from
  )
  values (
    v_student.studio_id,
    v_student.id,
    'bronze',
    v_activated_on,
    date_trunc('month', v_activated_on)::date
  );

  insert into public.reward_status_events (
    studio_id, student_id, period_start, event_type, from_level_key, to_level_key, details
  )
  values (
    v_student.studio_id,
    v_student.id,
    date_trunc('month', v_activated_on)::date,
    'activated',
    null,
    'bronze',
    jsonb_build_object(
      'source','admin_manual',
      'reason',v_reason,
      'admin_user_id',(select auth.uid())
    )
  );

  update private.reward_medal_onboarding
  set bronze_unlocked_at = clock_timestamp(),
      unlock_method = 'admin',
      unlocked_by = (select auth.uid()),
      unlock_reason = v_reason,
      updated_at = clock_timestamp()
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  returning * into v_onboarding;

  return private.reward_onboarding_sync_student(v_student.id);
end;
$$;

revoke all on function public.admin_grant_bronze_medal(uuid,text)
from public, anon;
grant execute on function public.admin_grant_bronze_medal(uuid,text)
to authenticated;

create or replace function public.student_update_own_birth_date(target_birth_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_definition public.profile_field_definitions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found or v_student.person_id is null then
    raise exception 'student_context_not_found';
  end if;
  if not private.has_capability(v_student.studio_id,'student.profile.self') then
    raise exception 'forbidden';
  end if;
  if target_birth_date is not null
    and (target_birth_date > current_date or target_birth_date < date '1900-01-01') then
    raise exception 'birth_date_invalid';
  end if;

  select * into v_definition
  from public.profile_field_definitions d
  where d.studio_id = v_student.studio_id
    and d.entity_type = 'student'
    and d.key = 'birth_date'
    and d.active = true
  limit 1;

  if not found then
    raise exception 'birth_date_field_not_configured';
  end if;

  if target_birth_date is null then
    delete from public.profile_field_values
    where definition_id = v_definition.id
      and person_id = v_student.person_id;
  else
    insert into public.profile_field_values (
      definition_id, person_id, studio_id, value
    )
    values (
      v_definition.id,
      v_student.person_id,
      v_student.studio_id,
      to_jsonb(target_birth_date::text)
    )
    on conflict (definition_id, person_id)
    do update set
      value = excluded.value,
      updated_at = clock_timestamp();
  end if;

  perform private.reward_onboarding_sync_student(v_student.id);

  return jsonb_build_object(
    'ok', true,
    'birth_date', target_birth_date
  );
end;
$$;

revoke all on function public.student_update_own_birth_date(date)
from public, anon;
grant execute on function public.student_update_own_birth_date(date)
to authenticated;

create or replace function private.reward_onboarding_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_id is not null then
    begin
      perform private.reward_onboarding_sync_student(new.student_id);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

create or replace function private.reward_onboarding_from_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.reward_onboarding_sync_student(new.id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function private.reward_onboarding_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
begin
  for v_student in
    select s.id
    from public.students s
    where s.user_id = new.id
  loop
    begin
      perform private.reward_onboarding_sync_student(v_student.id);
    exception when others then
      null;
    end;
  end loop;
  return new;
end;
$$;

create or replace function private.reward_onboarding_from_profile_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id uuid := coalesce(new.person_id, old.person_id);
  v_student record;
begin
  for v_student in
    select s.id
    from public.students s
    where s.person_id = v_person_id
  loop
    begin
      perform private.reward_onboarding_sync_student(v_student.id);
    exception when others then
      null;
    end;
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function private.reward_onboarding_from_reservation()
from public, anon, authenticated, service_role;
revoke all on function private.reward_onboarding_from_student()
from public, anon, authenticated, service_role;
revoke all on function private.reward_onboarding_from_profile()
from public, anon, authenticated, service_role;
revoke all on function private.reward_onboarding_from_profile_value()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_reservation_sync on public.reservations;
create trigger reward_onboarding_reservation_sync
after insert or update of status on public.reservations
for each row execute function private.reward_onboarding_from_reservation();

drop trigger if exists reward_onboarding_student_sync on public.students;
create trigger reward_onboarding_student_sync
after update of email, user_id, active, lifecycle_status on public.students
for each row execute function private.reward_onboarding_from_student();

drop trigger if exists reward_onboarding_profile_sync on public.profiles;
create trigger reward_onboarding_profile_sync
after insert or update of avatar_url on public.profiles
for each row execute function private.reward_onboarding_from_profile();

drop trigger if exists reward_onboarding_profile_value_sync on public.profile_field_values;
create trigger reward_onboarding_profile_value_sync
after insert or update or delete on public.profile_field_values
for each row execute function private.reward_onboarding_from_profile_value();

-- Existing students keep their current medal. We snapshot that as a legacy unlock
-- without fabricating completion of onboarding steps.
insert into private.reward_medal_onboarding (
  studio_id,
  student_id,
  bronze_unlocked_at,
  unlock_method
)
select
  s.studio_id,
  s.id,
  m.created_at,
  'legacy'
from public.students s
join public.reward_status_memberships m
  on m.studio_id = s.studio_id
 and m.student_id = s.id
on conflict (studio_id, student_id) do nothing;

insert into private.reward_medal_onboarding (studio_id, student_id)
select s.studio_id, s.id
from public.students s
on conflict (studio_id, student_id) do nothing;

do $$
declare
  v_student record;
begin
  for v_student in select id from public.students order by created_at,id
  loop
    perform private.reward_onboarding_sync_student(v_student.id);
  end loop;
end
$$;

-- New students no longer receive Bronze merely for being created.
create or replace function private.seed_reward_status_for_new_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.reward_medal_onboarding (studio_id, student_id)
  values (new.studio_id, new.id)
  on conflict (studio_id, student_id) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_reward_status_for_new_student()
from public, anon, authenticated, service_role;

-- Reward status is only evaluated after a medal membership exists.
create or replace function private.reward_status_sync_student(
  p_student_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_membership public.reward_status_memberships%rowtype;
  v_timezone text;
  v_current_period date;
  v_period date;
  v_period_end date;
  v_metrics jsonb;
  v_from_level text;
  v_to_level text;
  v_previous_level text;
  v_next_level text;
  v_outcome text;
  v_first_partial boolean;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_status_student_not_found';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  select * into v_membership
  from public.reward_status_memberships
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if not found then
    return jsonb_build_object(
      'not_activated', true,
      'current_level', null,
      'next_level', null,
      'attendance_count', 0,
      'maintenance_met', false,
      'promotion_met', false
    );
  end if;

  v_current_period := date_trunc('month', p_as_of)::date;
  v_period := coalesce(
    (v_membership.last_closed_period_start + interval '1 month')::date,
    date_trunc('month', v_membership.activated_on)::date
  );

  while v_period < v_current_period loop
    v_period_end := (v_period + interval '1 month - 1 day')::date;
    v_metrics := private.reward_status_metrics(v_student.id, v_period, v_period_end);

    select current_level_key into v_from_level
    from public.reward_status_memberships
    where studio_id = v_student.studio_id
      and student_id = v_student.id;

    v_to_level := v_from_level;
    v_outcome := 'maintained';
    v_first_partial := v_membership.activated_on > v_period
      and v_membership.activated_on <= v_period_end;

    if coalesce((v_metrics->>'promotion_met')::boolean, false) then
      v_next_level := v_metrics->'next_level'->>'key';
      if v_next_level is not null then
        v_to_level := v_next_level;
        v_outcome := 'promoted';
      end if;
    elsif v_first_partial then
      v_outcome := 'partial_month';
    elsif coalesce((v_metrics->>'maintenance_met')::boolean, false) then
      v_outcome := 'maintained';
    elsif v_from_level = 'bronze' then
      v_outcome := 'floor';
    else
      select d.level_key into v_previous_level
      from public.reward_status_level_definitions d
      where d.studio_id = v_student.studio_id
        and d.level_order = private.reward_status_level_order(v_from_level) - 1;

      v_to_level := coalesce(v_previous_level, 'bronze');
      v_outcome := 'demoted';
    end if;

    insert into public.reward_status_months (
      studio_id, student_id, period_start, period_end, level_key_at_start,
      attendance_count, active_months, max_uncovered_days, maintenance_met,
      promotion_met, next_level_key, outcome, resulting_level_key, is_closed,
      evaluated_at, closed_at
    )
    values (
      v_student.studio_id, v_student.id, v_period, v_period_end, v_from_level,
      coalesce((v_metrics->>'attendance_count')::integer, 0),
      coalesce((v_metrics->>'active_months')::integer, 0),
      coalesce((v_metrics->>'max_uncovered_days')::integer, 0),
      coalesce((v_metrics->>'maintenance_met')::boolean, false),
      coalesce((v_metrics->>'promotion_met')::boolean, false),
      v_metrics->'next_level'->>'key', v_outcome, v_to_level, true, now(), now()
    )
    on conflict (studio_id, student_id, period_start)
    do update set
      period_end = excluded.period_end,
      level_key_at_start = excluded.level_key_at_start,
      attendance_count = excluded.attendance_count,
      active_months = excluded.active_months,
      max_uncovered_days = excluded.max_uncovered_days,
      maintenance_met = excluded.maintenance_met,
      promotion_met = excluded.promotion_met,
      next_level_key = excluded.next_level_key,
      outcome = excluded.outcome,
      resulting_level_key = excluded.resulting_level_key,
      is_closed = true,
      evaluated_at = now(),
      closed_at = coalesce(public.reward_status_months.closed_at, now()),
      updated_at = now();

    insert into public.reward_status_events (
      studio_id, student_id, period_start, event_type,
      from_level_key, to_level_key, details
    )
    values (
      v_student.studio_id, v_student.id, v_period, v_outcome,
      v_from_level, v_to_level,
      jsonb_build_object(
        'attendance_count', coalesce((v_metrics->>'attendance_count')::integer, 0),
        'active_months', coalesce((v_metrics->>'active_months')::integer, 0),
        'max_uncovered_days', coalesce((v_metrics->>'max_uncovered_days')::integer, 0)
      )
    );

    update public.reward_status_memberships
    set current_level_key = v_to_level,
        level_effective_from = (v_period + interval '1 month')::date,
        last_closed_period_start = v_period,
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id;

    v_membership.current_level_key := v_to_level;
    v_membership.last_closed_period_start := v_period;
    v_period := (v_period + interval '1 month')::date;
  end loop;

  v_metrics := private.reward_status_metrics(v_student.id, v_current_period, p_as_of);

  select current_level_key into v_from_level
  from public.reward_status_memberships
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  insert into public.reward_status_months (
    studio_id, student_id, period_start, period_end, level_key_at_start,
    attendance_count, active_months, max_uncovered_days, maintenance_met,
    promotion_met, next_level_key, outcome, resulting_level_key, is_closed,
    evaluated_at, closed_at
  )
  values (
    v_student.studio_id,
    v_student.id,
    v_current_period,
    (v_current_period + interval '1 month - 1 day')::date,
    v_from_level,
    coalesce((v_metrics->>'attendance_count')::integer, 0),
    coalesce((v_metrics->>'active_months')::integer, 0),
    coalesce((v_metrics->>'max_uncovered_days')::integer, 0),
    coalesce((v_metrics->>'maintenance_met')::boolean, false),
    coalesce((v_metrics->>'promotion_met')::boolean, false),
    v_metrics->'next_level'->>'key',
    'pending', null, false, now(), null
  )
  on conflict (studio_id, student_id, period_start)
  do update set
    period_end = excluded.period_end,
    level_key_at_start = excluded.level_key_at_start,
    attendance_count = excluded.attendance_count,
    active_months = excluded.active_months,
    max_uncovered_days = excluded.max_uncovered_days,
    maintenance_met = excluded.maintenance_met,
    promotion_met = excluded.promotion_met,
    next_level_key = excluded.next_level_key,
    outcome = 'pending',
    resulting_level_key = null,
    is_closed = false,
    evaluated_at = now(),
    closed_at = null,
    updated_at = now();

  return v_metrics;
end;
$$;

create or replace function public.student_reward_status_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_metrics jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select coalesce(st.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_metrics := private.reward_status_sync_student(v_student.id, v_today);

  return v_metrics || jsonb_build_object(
    'student_id', v_student.id,
    'studio_id', v_student.studio_id,
    'level_key', v_metrics->'current_level'->>'key',
    'level_title', v_metrics->'current_level'->>'title',
    'medal_key', v_metrics->'current_level'->>'key',
    'medal_title', v_metrics->'current_level'->>'title',
    'status_period', date_trunc('month', v_today)::date
  );
end;
$$;

-- A student without a medal gets no reward discount, but checkout remains available.
create or replace function private.reward_checkout_price(
  p_student_id uuid,
  p_product_template_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_regular integer;
  v_pct integer := 0;
  v_final integer;
  v_discount integer;
begin
  if p_student_id is null or p_product_template_id is null or p_as_of is null then
    raise exception 'reward_price_arguments_required';
  end if;

  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;

  select * into v_product
  from public.product_templates
  where id=p_product_template_id and studio_id=v_student.studio_id;
  if not found then raise exception 'product_not_found'; end if;

  perform private.reward_status_sync_student(v_student.id,p_as_of);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id=m.studio_id and d.level_key=m.current_level_key
  where m.studio_id=v_student.studio_id and m.student_id=v_student.id;

  v_regular := v_product.price_minor;

  if v_level.id is not null
     and v_product.reward_discount_eligible
     and v_product.reward_discount_family is not null then
    if v_product.reward_discount_family = 'private_class' then
      v_pct := coalesce(v_level.private_discount_pct,0);
    else
      v_pct := coalesce(v_level.event_discount_pct,0);
    end if;
  end if;

  v_pct := greatest(0,least(v_pct,100));
  v_final := greatest(1,round(v_regular::numeric*(100-v_pct)::numeric/100)::integer);
  v_discount := v_regular-v_final;

  return jsonb_build_object(
    'product_template_id',v_product.id,
    'eligible',v_level.id is not null
      and v_product.reward_discount_eligible
      and v_product.reward_discount_family is not null,
    'discount_family',v_product.reward_discount_family,
    'level_key',v_level.level_key,
    'level_title',v_level.title,
    'medal_key',v_level.level_key,
    'medal_title',v_level.title,
    'discount_pct',v_pct,
    'regular_amount_minor',v_regular,
    'discount_minor',v_discount,
    'final_amount_minor',v_final,
    'currency',upper(v_product.currency)
  );
end;
$$;

-- No medal means zero guest invitations, not an application error.
create or replace function private.reward_invitation_balance(p_student_id uuid,p_as_of date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_membership public.reward_status_memberships%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_period_start date;
  v_total integer:=0;
  v_used integer:=0;
begin
  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;

  perform private.reward_status_sync_student(v_student.id,p_as_of);

  select * into v_membership
  from public.reward_status_memberships
  where studio_id=v_student.studio_id and student_id=v_student.id;

  v_period_start:=date_trunc('month',p_as_of)::date;

  if not found then
    return jsonb_build_object(
      'period_start',v_period_start,
      'level_key',null,
      'level_title',null,
      'medal_key',null,
      'medal_title',null,
      'total',0,'used',0,'remaining',0
    );
  end if;

  select * into v_level
  from public.reward_status_level_definitions
  where studio_id=v_student.studio_id and level_key=v_membership.current_level_key;

  if not found then raise exception 'reward_level_not_found'; end if;

  v_total:=coalesce(v_level.monthly_guest_invites,0);

  select count(*)::integer into v_used
  from public.reward_guest_invitations i
  where i.studio_id=v_student.studio_id
    and i.host_student_id=v_student.id
    and i.period_start=v_period_start
    and i.status in ('active','attended','no_show','cancelled_late');

  return jsonb_build_object(
    'period_start',v_period_start,
    'level_key',v_level.level_key,
    'level_title',v_level.title,
    'medal_key',v_level.level_key,
    'medal_title',v_level.title,
    'total',v_total,
    'used',v_used,
    'remaining',greatest(v_total-v_used,0)
  );
end;
$$;

-- New-student trigger now seeds only onboarding, never Bronze.
drop trigger if exists reward_status_seed_student on public.students;
create trigger reward_status_seed_student
after insert on public.students
for each row execute function private.seed_reward_status_for_new_student();


-- Waitlist remains available before the first medal. No-medal students have
-- base priority 0, below Bronze, and are still ordered FIFO among themselves.
create or replace function public.student_join_waitlist(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_booked integer;
  v_eligibility jsonb;
  v_entry public.class_waitlist_entries%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then raise exception 'session_not_found'; end if;

  select s.* into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'forbidden'; end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = v_session.id
      and r.student_id = v_student.id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  select * into v_entry
  from public.class_waitlist_entries w
  where w.session_id = v_session.id
    and w.student_id = v_student.id
    and w.status = 'active'
  order by w.joined_at asc
  limit 1;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  perform private.reward_status_sync_student(v_student.id, v_today);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id=m.studio_id
   and d.level_key=m.current_level_key
  where m.studio_id=v_student.studio_id
    and m.student_id=v_student.id;

  if v_entry.id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'waitlist_entry_id', v_entry.id,
      'status', 'active',
      'level_key', v_level.level_key,
      'level_title', v_level.title,
      'medal_key', v_level.level_key,
      'medal_title', v_level.title,
      'waitlist_priority', coalesce(v_level.waitlist_priority,0)
    );
  end if;

  select count(*)::integer into v_booked
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_booked < v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'seat_available');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','waitlist_not_eligible')
    );
  end if;

  insert into public.class_waitlist_entries (
    studio_id, session_id, student_id, status
  )
  values (
    v_student.studio_id, v_session.id, v_student.id, 'active'
  )
  returning * into v_entry;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'waitlist_entry_id', v_entry.id,
    'status', 'active',
    'level_key', v_level.level_key,
    'level_title', v_level.title,
    'medal_key', v_level.level_key,
    'medal_title', v_level.title,
    'waitlist_priority', coalesce(v_level.waitlist_priority,0)
  );
end;
$$;

revoke all on function public.student_join_waitlist(uuid)
from public, anon;
grant execute on function public.student_join_waitlist(uuid)
to authenticated;

create or replace function private.promote_waitlist_for_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_timezone text;
  v_today date;
  v_candidate record;
  v_result jsonb;
begin
  select * into v_session
  from public.class_sessions
  where id=p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    update public.class_waitlist_entries
    set status='expired',
        resolved_at=now(),
        resolution_reason='session_not_bookable',
        updated_at=now()
    where session_id=v_session.id and status='active';

    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id=v_session.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  for v_candidate in
    select w.student_id
    from public.class_waitlist_entries w
    where w.session_id=v_session.id and w.status='active'
    order by w.joined_at asc, w.id asc
  loop
    perform private.reward_status_sync_student(v_candidate.student_id, v_today);
  end loop;

  for v_candidate in
    select
      w.id,
      w.student_id,
      coalesce(d.level_order,0) as medal_order,
      w.joined_at
    from public.class_waitlist_entries w
    left join public.reward_status_memberships m
      on m.studio_id=w.studio_id and m.student_id=w.student_id
    left join public.reward_status_level_definitions d
      on d.studio_id=m.studio_id and d.level_key=m.current_level_key
    where w.session_id=v_session.id and w.status='active'
    order by coalesce(d.level_order,0) desc, w.joined_at asc, w.id asc
  loop
    v_result := private.waitlist_book_student(v_candidate.id);

    if coalesce((v_result->>'ok')::boolean, false) then
      return v_result;
    end if;

    if v_result->>'reason_code' = 'session_full' then
      return jsonb_build_object('ok', false, 'reason_code', 'session_full');
    end if;
  end loop;

  return jsonb_build_object('ok', false, 'reason_code', 'no_eligible_waitlist_entry');
end;
$$;

revoke all on function private.promote_waitlist_for_session(uuid)
from public, anon, authenticated, service_role;
