create index if not exists reservations_reward_attendance_source_idx
  on public.reservations(studio_id, student_id, status, session_id)
  where student_id is not null;

create or replace function public.system_compute_reward_attendance_state(
  p_rule_id uuid,
  p_version_number integer,
  p_student_id uuid,
  p_as_of_date date default null,
  p_window_start date default null,
  p_window_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student_studio_id uuid;
  v_timezone text;
  v_as_of date;
  v_allow_historical boolean;
  v_max_one_per_day boolean;
  v_eligibility_start date;
  v_rule_start date;
  v_rule_end date;
  v_window_start date;
  v_window_end date;
  v_result jsonb;
begin
  if p_rule_id is null
     or p_version_number is null
     or p_version_number < 1 then
    raise exception 'reward_attendance_rule_version_required';
  end if;

  if p_student_id is null then
    raise exception 'reward_attendance_student_required';
  end if;

  select *
    into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then
    raise exception 'reward_rule_not_found';
  end if;

  if v_rule.status <> 'active' then
    raise exception 'reward_attendance_rule_not_active';
  end if;

  select *
    into v_version
  from public.reward_rule_versions
  where rule_id = p_rule_id
    and version_number = p_version_number;

  if not found then
    raise exception 'reward_rule_version_not_found';
  end if;

  if v_version.studio_id <> v_rule.studio_id then
    raise exception 'reward_rule_version_studio_mismatch';
  end if;

  if v_version.family not in ('attendance', 'challenge', 'achievement') then
    raise exception 'reward_attendance_family_not_supported';
  end if;

  select s.studio_id
    into v_student_studio_id
  from public.students s
  where s.id = p_student_id;

  if v_student_studio_id is null then
    raise exception 'reward_student_not_found';
  end if;

  if v_student_studio_id <> v_rule.studio_id then
    raise exception 'reward_student_studio_mismatch';
  end if;

  select timezone
    into v_timezone
  from public.studios
  where id = v_rule.studio_id;

  v_as_of := coalesce(
    p_as_of_date,
    (clock_timestamp() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
  );

  begin
    v_allow_historical := coalesce(
      nullif(v_version.evaluation_definition->>'allow_historical', '')::boolean,
      false
    );
    v_max_one_per_day := coalesce(
      nullif(v_version.evaluation_definition->>'attendance_max_one_per_day', '')::boolean,
      false
    );
  exception when invalid_text_representation then
    raise exception 'reward_attendance_configuration_invalid';
  end;

  if not v_allow_historical then
    v_eligibility_start := greatest(
      coalesce(
        (v_rule.first_activated_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date,
        (v_version.effective_from at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
      ),
      (v_version.effective_from at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
    );
  end if;

  v_rule_start := case
    when v_rule.scheduled_start_at is null then null
    else (v_rule.scheduled_start_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
  end;

  v_rule_end := case
    when v_rule.scheduled_end_at is null then null
    else (v_rule.scheduled_end_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
  end;

  v_window_start := coalesce(
    p_window_start,
    v_rule_start,
    v_eligibility_start,
    date '1900-01-01'
  );

  if v_rule_start is not null then
    v_window_start := greatest(v_window_start, v_rule_start);
  end if;

  if v_eligibility_start is not null then
    v_window_start := greatest(v_window_start, v_eligibility_start);
  end if;

  v_window_end := least(
    coalesce(p_window_end, v_as_of),
    v_as_of,
    coalesce(v_rule_end, v_as_of)
  );

  if v_window_end < v_window_start then
    raise exception 'reward_attendance_window_invalid';
  end if;

  with source_rows as (
    select
      r.id as reservation_id,
      r.status::text as reservation_status,
      cs.id as session_id,
      cs.starts_at,
      (cs.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date as local_date,
      date_trunc(
        'week',
        cs.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
      )::date as week_start,
      date_trunc(
        'month',
        cs.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
      )::date as month_start,
      ct.discipline_id,
      d.name as discipline_name
    from public.reservations r
    join public.class_sessions cs
      on cs.id = r.session_id
     and cs.studio_id = r.studio_id
    join public.class_templates ct
      on ct.id = cs.template_id
     and ct.studio_id = r.studio_id
    join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = r.studio_id
    where r.studio_id = v_rule.studio_id
      and r.student_id = p_student_id
      and (cs.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
          between v_window_start and v_window_end
      and r.status in (
        'attended',
        'no_show',
        'cancelled_on_time',
        'cancelled_late',
        'cancelled_by_studio'
      )
  ),
  attended_ranked as (
    select
      s.*,
      row_number() over (
        partition by s.local_date
        order by s.starts_at, s.reservation_id
      ) as attendance_number_that_day
    from source_rows s
    where s.reservation_status = 'attended'
  ),
  counted_attendance as (
    select *
    from attended_ranked
    where not v_max_one_per_day
       or attendance_number_that_day = 1
  ),
  discipline_summary as (
    select
      a.discipline_id,
      max(a.discipline_name) as discipline_name,
      count(*)::integer as attendance_count
    from attended_ranked a
    group by a.discipline_id
  )
  select jsonb_build_object(
    'rule_id', p_rule_id,
    'version_number', p_version_number,
    'student_id', p_student_id,
    'as_of_date', v_as_of,
    'window_start', v_window_start,
    'window_end', v_window_end,
    'allow_historical', v_allow_historical,
    'attendance_max_one_per_day', v_max_one_per_day,
    'raw_attendance_count', (
      select count(*)::integer
      from attended_ranked
    ),
    'counted_attendance_count', (
      select count(*)::integer
      from counted_attendance
    ),
    'distinct_attendance_days', (
      select count(distinct local_date)::integer
      from attended_ranked
    ),
    'distinct_attendance_weeks', (
      select count(distinct week_start)::integer
      from attended_ranked
    ),
    'distinct_attendance_months', (
      select count(distinct month_start)::integer
      from attended_ranked
    ),
    'distinct_disciplines', (
      select count(distinct discipline_id)::integer
      from attended_ranked
    ),
    'no_show_count', (
      select count(*)::integer
      from source_rows
      where reservation_status = 'no_show'
    ),
    'cancellation_count', (
      select count(*)::integer
      from source_rows
      where reservation_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio')
    ),
    'attended_dates', coalesce((
      select jsonb_agg(x.local_date order by x.local_date)
      from (
        select distinct local_date
        from attended_ranked
      ) x
    ), '[]'::jsonb),
    'attended_weeks', coalesce((
      select jsonb_agg(x.week_start order by x.week_start)
      from (
        select distinct week_start
        from attended_ranked
      ) x
    ), '[]'::jsonb),
    'attended_months', coalesce((
      select jsonb_agg(x.month_start order by x.month_start)
      from (
        select distinct month_start
        from attended_ranked
      ) x
    ), '[]'::jsonb),
    'no_show_dates', coalesce((
      select jsonb_agg(x.local_date order by x.local_date)
      from (
        select distinct local_date
        from source_rows
        where reservation_status = 'no_show'
      ) x
    ), '[]'::jsonb),
    'cancellation_dates', coalesce((
      select jsonb_agg(x.local_date order by x.local_date)
      from (
        select distinct local_date
        from source_rows
        where reservation_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio')
      ) x
    ), '[]'::jsonb),
    'counted_reservation_ids', coalesce((
      select jsonb_agg(reservation_id order by starts_at, reservation_id)
      from counted_attendance
    ), '[]'::jsonb),
    'discipline_counts', coalesce((
      select jsonb_object_agg(
        discipline_id::text,
        jsonb_build_object(
          'discipline_id', discipline_id,
          'name', discipline_name,
          'attendance_count', attendance_count
        )
      )
      from discipline_summary
    ), '{}'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.system_compute_reward_attendance_state(uuid,integer,uuid,date,date,date) is
  'SF-238 derives attendance, frequency and variety facts from reservation status attended. Reservations and corrections remain the source of truth.';

revoke all on function public.system_compute_reward_attendance_state(uuid,integer,uuid,date,date,date)
from public, anon, authenticated;
grant execute on function public.system_compute_reward_attendance_state(uuid,integer,uuid,date,date,date)
to service_role;

create table public.reward_achievement_unlocks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  rule_id uuid not null,
  version_number integer not null check (version_number >= 1),
  source_evaluation_id uuid not null,
  achievement_key text not null check (length(trim(achievement_key)) > 0),
  level_key text,
  title_snapshot text not null check (length(trim(title_snapshot)) > 0),
  badge_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(badge_snapshot) = 'object'),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  unlocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_achievement_unlocks_studio_id_unique unique (studio_id, id),
  constraint reward_achievement_unlocks_idempotency_unique unique (studio_id, idempotency_key),
  constraint reward_achievement_unlocks_rule_tenant_fkey
    foreign key (studio_id, rule_id)
    references public.reward_rules(studio_id, id)
    on delete restrict,
  constraint reward_achievement_unlocks_rule_version_fkey
    foreign key (rule_id, version_number)
    references public.reward_rule_versions(rule_id, version_number)
    on delete restrict,
  constraint reward_achievement_unlocks_evaluation_fkey
    foreign key (studio_id, source_evaluation_id)
    references public.reward_progress_evaluations(studio_id, id)
    on delete restrict
);

create unique index reward_achievement_unlocks_student_key_unique
  on public.reward_achievement_unlocks(
    studio_id,
    student_id,
    achievement_key,
    coalesce(level_key, '')
  );

create index reward_achievement_unlocks_student_idx
  on public.reward_achievement_unlocks(studio_id, student_id, unlocked_at desc);

alter table public.reward_achievement_unlocks enable row level security;

create policy reward_achievement_unlocks_read
on public.reward_achievement_unlocks
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

revoke all on table public.reward_achievement_unlocks
from anon, authenticated, service_role;
grant select on table public.reward_achievement_unlocks
to authenticated, service_role;

create trigger reward_achievement_unlocks_immutable
before update or delete on public.reward_achievement_unlocks
for each row execute function private.reject_reward_history_mutation();

create or replace function public.system_unlock_reward_achievement(
  p_source_evaluation_id uuid,
  p_achievement_key text,
  p_title_snapshot text,
  p_badge_snapshot jsonb default '{}'::jsonb,
  p_level_key text default null,
  p_idempotency_key text default null,
  p_unlocked_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.reward_progress_evaluations%rowtype;
  v_existing public.reward_achievement_unlocks%rowtype;
  v_unlock_id uuid;
  v_idempotency_key text;
begin
  if p_source_evaluation_id is null then
    raise exception 'reward_achievement_source_evaluation_required';
  end if;

  if trim(coalesce(p_achievement_key, '')) = '' then
    raise exception 'reward_achievement_key_required';
  end if;

  if trim(coalesce(p_title_snapshot, '')) = '' then
    raise exception 'reward_achievement_title_required';
  end if;

  if p_badge_snapshot is null or jsonb_typeof(p_badge_snapshot) <> 'object' then
    raise exception 'reward_achievement_badge_must_be_object';
  end if;

  select *
    into v_evaluation
  from public.reward_progress_evaluations
  where id = p_source_evaluation_id;

  if not found then
    raise exception 'reward_progress_evaluation_not_found';
  end if;

  if not v_evaluation.fulfilled then
    raise exception 'reward_achievement_source_not_fulfilled';
  end if;

  v_idempotency_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'achievement:' || v_evaluation.rule_id::text
      || ':student:' || v_evaluation.student_id::text
      || ':key:' || trim(p_achievement_key)
      || ':level:' || coalesce(nullif(trim(coalesce(p_level_key, '')), ''), 'base')
  );

  select *
    into v_existing
  from public.reward_achievement_unlocks
  where studio_id = v_evaluation.studio_id
    and idempotency_key = v_idempotency_key;

  if found then
    return jsonb_build_object(
      'achievement_unlock_id', v_existing.id,
      'created', false,
      'unlocked_at', v_existing.unlocked_at
    );
  end if;

  select *
    into v_existing
  from public.reward_achievement_unlocks
  where studio_id = v_evaluation.studio_id
    and student_id = v_evaluation.student_id
    and achievement_key = trim(p_achievement_key)
    and coalesce(level_key, '') = coalesce(nullif(trim(coalesce(p_level_key, '')), ''), '');

  if found then
    return jsonb_build_object(
      'achievement_unlock_id', v_existing.id,
      'created', false,
      'unlocked_at', v_existing.unlocked_at
    );
  end if;

  insert into public.reward_achievement_unlocks (
    studio_id,
    student_id,
    rule_id,
    version_number,
    source_evaluation_id,
    achievement_key,
    level_key,
    title_snapshot,
    badge_snapshot,
    idempotency_key,
    unlocked_at
  ) values (
    v_evaluation.studio_id,
    v_evaluation.student_id,
    v_evaluation.rule_id,
    v_evaluation.version_number,
    v_evaluation.id,
    trim(p_achievement_key),
    nullif(trim(coalesce(p_level_key, '')), ''),
    trim(p_title_snapshot),
    p_badge_snapshot,
    v_idempotency_key,
    coalesce(p_unlocked_at, clock_timestamp())
  )
  returning id into v_unlock_id;

  return jsonb_build_object(
    'achievement_unlock_id', v_unlock_id,
    'created', true,
    'unlocked_at', coalesce(p_unlocked_at, clock_timestamp())
  );
end;
$$;

revoke all on function public.system_unlock_reward_achievement(uuid,text,text,jsonb,text,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.system_unlock_reward_achievement(uuid,text,text,jsonb,text,text,timestamptz)
to service_role;
