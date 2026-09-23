-- REWARDS · onboarding previo a Medalla Bronce
-- Bronce deja de asignarse por alta. Las medallas existentes se conservan.

create table if not exists public.reward_onboarding (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  documents_completed_at timestamptz,
  documents_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(documents_evidence) = 'object'),
  profile_completed_at timestamptz,
  profile_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile_evidence) = 'object'),
  first_reservation_at timestamptz,
  first_reservation_id uuid references public.reservations(id) on delete set null,
  first_attendance_at timestamptz,
  first_attendance_reservation_id uuid references public.reservations(id) on delete set null,
  completed_at timestamptz,
  bronze_unlocked_at timestamptz,
  bronze_acknowledged_at timestamptz,
  unlock_method text check (
    unlock_method is null or unlock_method in ('onboarding','admin','legacy')
  ),
  unlocked_by uuid references auth.users(id) on delete set null,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_onboarding_student_unique unique (studio_id, student_id),
  constraint reward_onboarding_admin_reason_chk check (
    unlock_method <> 'admin'
    or nullif(trim(coalesce(unlock_reason,'')), '') is not null
  )
);

comment on table public.reward_onboarding is
  'Pre-medal activation checklist. Reward medals are separate from technical levels.';

create index if not exists reward_onboarding_student_idx
  on public.reward_onboarding(studio_id, student_id);

alter table public.reward_onboarding enable row level security;

drop policy if exists reward_onboarding_read on public.reward_onboarding;
create policy reward_onboarding_read
on public.reward_onboarding
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

grant select on public.reward_onboarding to authenticated;

create or replace function private.reward_onboarding_try_unlock(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_onboarding public.reward_onboarding%rowtype;
  v_timezone text;
  v_activated_on date;
  v_created boolean := false;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then raise exception 'reward_onboarding_student_not_found'; end if;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if v_onboarding.bronze_unlocked_at is not null then
    return jsonb_build_object('unlocked', true, 'created', false, 'method', v_onboarding.unlock_method);
  end if;

  if exists (
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) then
    update public.reward_onboarding
    set bronze_unlocked_at = coalesce(bronze_unlocked_at, now()),
        bronze_acknowledged_at = coalesce(bronze_acknowledged_at, now()),
        unlock_method = coalesce(unlock_method, 'legacy'),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id;

    return jsonb_build_object('unlocked', true, 'created', false, 'method', 'legacy');
  end if;

  if v_onboarding.documents_completed_at is null
     or v_onboarding.profile_completed_at is null
     or v_onboarding.first_reservation_at is null
     or v_onboarding.first_attendance_at is null then
    return jsonb_build_object('unlocked', false, 'created', false, 'method', null);
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_status_memberships(
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
  returning true into v_created;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at, now()),
      bronze_unlocked_at = coalesce(bronze_unlocked_at, now()),
      unlock_method = coalesce(unlock_method, 'onboarding'),
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if coalesce(v_created, false) then
    insert into public.reward_status_events(
      studio_id,
      student_id,
      period_start,
      event_type,
      from_level_key,
      to_level_key,
      details
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
        'documents_completed_at', v_onboarding.documents_completed_at,
        'profile_completed_at', v_onboarding.profile_completed_at,
        'first_reservation_at', v_onboarding.first_reservation_at,
        'first_attendance_at', v_onboarding.first_attendance_at
      )
    );
  end if;

  return jsonb_build_object('unlocked', true, 'created', coalesce(v_created,false), 'method', 'onboarding');
end;
$$;

revoke all on function private.reward_onboarding_try_unlock(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_refresh_profile(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_email_ok boolean := false;
  v_avatar_ok boolean := false;
  v_birth_date_ok boolean := false;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then return; end if;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  select nullif(trim(coalesce(v_student.email,'')), '') is not null
    into v_email_ok;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_student.user_id
      and nullif(trim(coalesce(p.avatar_url,'')), '') is not null
  ) into v_avatar_ok;

  select exists (
    select 1
    from public.profile_field_definitions d
    join public.profile_field_values v
      on v.definition_id = d.id
     and v.person_id = v_student.person_id
    where d.studio_id = v_student.studio_id
      and d.entity_type = 'student'
      and d.key = 'birth_date'
      and d.active = true
      and v.value <> 'null'::jsonb
      and nullif(trim(v.value #>> '{}'), '') is not null
  ) into v_birth_date_ok;

  if v_email_ok and v_avatar_ok and v_birth_date_ok then
    update public.reward_onboarding
    set profile_completed_at = coalesce(profile_completed_at, now()),
        profile_evidence = jsonb_build_object(
          'email', true,
          'avatar', true,
          'birth_date', true
        ),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and profile_completed_at is null;
  else
    update public.reward_onboarding
    set profile_evidence = jsonb_build_object(
          'email', v_email_ok,
          'avatar', v_avatar_ok,
          'birth_date', v_birth_date_ok
        ),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and profile_completed_at is null;
  end if;

  perform private.reward_onboarding_try_unlock(v_student.id);
end;
$$;

revoke all on function private.reward_onboarding_refresh_profile(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_mark_documents_complete(
  p_student_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then raise exception 'reward_onboarding_student_not_found'; end if;

  insert into public.reward_onboarding(studio_id, student_id, documents_completed_at, documents_evidence)
  values (
    v_student.studio_id,
    v_student.id,
    now(),
    coalesce(p_evidence, '{}'::jsonb)
  )
  on conflict (studio_id, student_id)
  do update set
    documents_completed_at = coalesce(public.reward_onboarding.documents_completed_at, excluded.documents_completed_at),
    documents_evidence = case
      when public.reward_onboarding.documents_completed_at is null then excluded.documents_evidence
      else public.reward_onboarding.documents_evidence
    end,
    updated_at = now();

  perform private.reward_onboarding_try_unlock(v_student.id);
end;
$$;

revoke all on function private.reward_onboarding_mark_documents_complete(uuid,jsonb)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_capture_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_id is null then return new; end if;

  insert into public.reward_onboarding(
    studio_id,
    student_id,
    first_reservation_at,
    first_reservation_id
  )
  values (
    new.studio_id,
    new.student_id,
    new.booked_at,
    new.id
  )
  on conflict (studio_id, student_id)
  do update set
    first_reservation_at = coalesce(public.reward_onboarding.first_reservation_at, excluded.first_reservation_at),
    first_reservation_id = coalesce(public.reward_onboarding.first_reservation_id, excluded.first_reservation_id),
    updated_at = now();

  if new.status = 'attended' then
    update public.reward_onboarding
    set first_attendance_at = coalesce(first_attendance_at, now()),
        first_attendance_reservation_id = coalesce(first_attendance_reservation_id, new.id),
        updated_at = now()
    where studio_id = new.studio_id
      and student_id = new.student_id;
  end if;

  perform private.reward_onboarding_try_unlock(new.student_id);
  return new;
end;
$$;

revoke all on function private.reward_onboarding_capture_reservation()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_reservation_insert on public.reservations;
create trigger reward_onboarding_reservation_insert
after insert on public.reservations
for each row execute function private.reward_onboarding_capture_reservation();

drop trigger if exists reward_onboarding_attendance_update on public.reservations;
create trigger reward_onboarding_attendance_update
after update of status on public.reservations
for each row
when (new.student_id is not null and new.status = 'attended')
execute function private.reward_onboarding_capture_reservation();

create or replace function private.reward_onboarding_profile_from_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reward_onboarding_refresh_profile(new.id);
  return new;
end;
$$;

revoke all on function private.reward_onboarding_profile_from_student()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_student_profile_refresh on public.students;
create trigger reward_onboarding_student_profile_refresh
after update of email, user_id on public.students
for each row execute function private.reward_onboarding_profile_from_student();

create or replace function private.reward_onboarding_profile_from_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  select s.id into v_student_id
  from public.students s
  where s.user_id = new.id
  order by s.created_at asc
  limit 1;

  if v_student_id is not null then
    perform private.reward_onboarding_refresh_profile(v_student_id);
  end if;

  return new;
end;
$$;

revoke all on function private.reward_onboarding_profile_from_auth_profile()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_avatar_refresh on public.profiles;
create trigger reward_onboarding_avatar_refresh
after insert or update of avatar_url on public.profiles
for each row execute function private.reward_onboarding_profile_from_auth_profile();

create or replace function private.reward_onboarding_profile_from_field_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id uuid := coalesce(new.person_id, old.person_id);
  v_student_id uuid;
  v_definition_id uuid := coalesce(new.definition_id, old.definition_id);
  v_key text;
begin
  select d.key into v_key
  from public.profile_field_definitions d
  where d.id = v_definition_id;

  if v_key <> 'birth_date' then
    return coalesce(new, old);
  end if;

  select s.id into v_student_id
  from public.students s
  where s.person_id = v_person_id
  limit 1;

  if v_student_id is not null then
    perform private.reward_onboarding_refresh_profile(v_student_id);
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.reward_onboarding_profile_from_field_value()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_birth_date_refresh on public.profile_field_values;
create trigger reward_onboarding_birth_date_refresh
after insert or update or delete on public.profile_field_values
for each row execute function private.reward_onboarding_profile_from_field_value();

create or replace function private.seed_reward_onboarding_for_new_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_onboarding(studio_id, student_id)
  values (new.studio_id, new.id)
  on conflict (studio_id, student_id) do nothing;

  perform private.reward_onboarding_refresh_profile(new.id);
  return new;
end;
$$;

revoke all on function private.seed_reward_onboarding_for_new_student()
from public, anon, authenticated, service_role;

drop trigger if exists reward_status_seed_student on public.students;
drop trigger if exists reward_onboarding_seed_student on public.students;
create trigger reward_onboarding_seed_student
after insert on public.students
for each row execute function private.seed_reward_onboarding_for_new_student();

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
      studio_id,
      student_id,
      period_start,
      period_end,
      level_key_at_start,
      attendance_count,
      active_months,
      max_uncovered_days,
      maintenance_met,
      promotion_met,
      next_level_key,
      outcome,
      resulting_level_key,
      is_closed,
      evaluated_at,
      closed_at
    )
    values (
      v_student.studio_id,
      v_student.id,
      v_period,
      v_period_end,
      v_from_level,
      coalesce((v_metrics->>'attendance_count')::integer, 0),
      coalesce((v_metrics->>'active_months')::integer, 0),
      coalesce((v_metrics->>'max_uncovered_days')::integer, 0),
      coalesce((v_metrics->>'maintenance_met')::boolean, false),
      coalesce((v_metrics->>'promotion_met')::boolean, false),
      v_metrics->'next_level'->>'key',
      v_outcome,
      v_to_level,
      true,
      now(),
      now()
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
      studio_id,
      student_id,
      period_start,
      event_type,
      from_level_key,
      to_level_key,
      details
    )
    values (
      v_student.studio_id,
      v_student.id,
      v_period,
      v_outcome,
      v_from_level,
      v_to_level,
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
    studio_id,
    student_id,
    period_start,
    period_end,
    level_key_at_start,
    attendance_count,
    active_months,
    max_uncovered_days,
    maintenance_met,
    promotion_met,
    next_level_key,
    outcome,
    resulting_level_key,
    is_closed,
    evaluated_at,
    closed_at
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
    'pending',
    null,
    false,
    now(),
    null
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

create or replace function private.student_set_reward_onboarding_birth_date(
  p_student_id uuid,
  p_birth_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_definition_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_student
  from public.students
  where id = p_student_id
    and user_id = (select auth.uid())
    and private.is_current_student(id, studio_id)
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;
  if not private.has_capability(v_student.studio_id, 'student.profile.self') then
    raise exception 'forbidden';
  end if;
  if p_birth_date is null then raise exception 'birth_date_required'; end if;
  if p_birth_date < date '1900-01-01'
     or p_birth_date > (clock_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception 'birth_date_invalid';
  end if;

  select d.id into v_definition_id
  from public.profile_field_definitions d
  where d.studio_id = v_student.studio_id
    and d.entity_type = 'student'
    and d.key = 'birth_date'
    and d.active = true
  limit 1;

  if v_definition_id is null then raise exception 'birth_date_field_missing'; end if;

  insert into public.profile_field_values(
    definition_id,
    person_id,
    studio_id,
    value
  )
  values (
    v_definition_id,
    v_student.person_id,
    v_student.studio_id,
    to_jsonb(p_birth_date::text)
  )
  on conflict (definition_id, person_id)
  do update set
    value = excluded.value,
    updated_at = now();

  perform private.reward_onboarding_refresh_profile(v_student.id);
end;
$$;

revoke all on function private.student_set_reward_onboarding_birth_date(uuid,date)
from public, anon, service_role;
grant execute on function private.student_set_reward_onboarding_birth_date(uuid,date)
to authenticated;

create or replace function public.student_update_reward_onboarding_profile(
  target_email text,
  target_birth_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  perform public.student_update_own_profile(null, null, target_email);

  select s.id into v_student_id
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student_id is null then raise exception 'student_context_not_found'; end if;

  perform private.student_set_reward_onboarding_birth_date(v_student_id, target_birth_date);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.student_update_reward_onboarding_profile(text,date)
from public, anon;
grant execute on function public.student_update_reward_onboarding_profile(text,date)
to authenticated;

create or replace function private.admin_grant_bronze_medal_internal(
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
  v_created boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if v_reason is null then raise exception 'reward_onboarding_reason_required'; end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then raise exception 'student_not_found'; end if;

  if not private.has_capability(v_student.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;
  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  insert into public.reward_status_memberships(
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
  returning true into v_created;

  update public.reward_onboarding
  set bronze_unlocked_at = coalesce(bronze_unlocked_at, now()),
      unlock_method = case when bronze_unlocked_at is null then 'admin' else unlock_method end,
      unlocked_by = case when bronze_unlocked_at is null then (select auth.uid()) else unlocked_by end,
      unlock_reason = case when bronze_unlocked_at is null then v_reason else unlock_reason end,
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if coalesce(v_created,false) then
    insert into public.reward_status_events(
      studio_id, student_id, period_start, event_type,
      from_level_key, to_level_key, details
    )
    values (
      v_student.studio_id,
      v_student.id,
      date_trunc('month', v_activated_on)::date,
      'activated',
      null,
      'bronze',
      jsonb_build_object(
        'source', 'reward_onboarding_admin',
        'reason', v_reason,
        'admin_user_id', (select auth.uid())
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', coalesce(v_created,false),
    'medal_key', 'bronze'
  );
end;
$$;

revoke all on function private.admin_grant_bronze_medal_internal(uuid,text)
from public, anon, service_role;
grant execute on function private.admin_grant_bronze_medal_internal(uuid,text)
to authenticated;

create or replace function public.admin_grant_bronze_medal(
  p_student_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_grant_bronze_medal_internal(p_student_id, p_reason);
$$;

revoke all on function public.admin_grant_bronze_medal(uuid,text)
from public, anon;
grant execute on function public.admin_grant_bronze_medal(uuid,text)
to authenticated;

create or replace function public.student_acknowledge_bronze_unlock()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  select s.id into v_student_id
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student_id is null then raise exception 'student_context_not_found'; end if;

  update public.reward_onboarding o
  set bronze_acknowledged_at = coalesce(o.bronze_acknowledged_at, now()),
      updated_at = now()
  where o.student_id = v_student_id
    and o.bronze_unlocked_at is not null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.student_acknowledge_bronze_unlock()
from public, anon;
grant execute on function public.student_acknowledge_bronze_unlock()
to authenticated;

insert into public.reward_onboarding(
  studio_id,
  student_id,
  bronze_unlocked_at,
  bronze_acknowledged_at,
  unlock_method
)
select
  s.studio_id,
  s.id,
  m.created_at,
  m.created_at,
  'legacy'
from public.students s
left join public.reward_status_memberships m
  on m.studio_id = s.studio_id
 and m.student_id = s.id
on conflict (studio_id, student_id)
do update set
  bronze_unlocked_at = coalesce(public.reward_onboarding.bronze_unlocked_at, excluded.bronze_unlocked_at),
  bronze_acknowledged_at = coalesce(public.reward_onboarding.bronze_acknowledged_at, excluded.bronze_acknowledged_at),
  unlock_method = coalesce(public.reward_onboarding.unlock_method, excluded.unlock_method),
  updated_at = now();

do $$
declare
  v_student record;
  v_first_reservation record;
  v_first_attendance record;
begin
  for v_student in
    select id, studio_id from public.students order by created_at, id
  loop
    perform private.reward_onboarding_refresh_profile(v_student.id);

    select r.id, r.booked_at
      into v_first_reservation
    from public.reservations r
    where r.student_id = v_student.id
    order by r.booked_at asc, r.id asc
    limit 1;

    if v_first_reservation.id is not null then
      update public.reward_onboarding
      set first_reservation_at = coalesce(first_reservation_at, v_first_reservation.booked_at),
          first_reservation_id = coalesce(first_reservation_id, v_first_reservation.id),
          updated_at = now()
      where studio_id = v_student.studio_id
        and student_id = v_student.id;
    end if;

    select r.id, r.updated_at
      into v_first_attendance
    from public.reservations r
    where r.student_id = v_student.id
      and r.status = 'attended'
    order by r.updated_at asc, r.id asc
    limit 1;

    if v_first_attendance.id is not null then
      update public.reward_onboarding
      set first_attendance_at = coalesce(first_attendance_at, v_first_attendance.updated_at),
          first_attendance_reservation_id = coalesce(first_attendance_reservation_id, v_first_attendance.id),
          updated_at = now()
      where studio_id = v_student.studio_id
        and student_id = v_student.id;
    end if;

    perform private.reward_onboarding_try_unlock(v_student.id);
  end loop;
end
$$;
