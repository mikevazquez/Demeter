-- SF-255A · Rewards · monthly student status levels
-- Deterministic monthly status model. Separate from SF-251 permanent program unlocks.

create table public.reward_status_level_definitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  level_key text not null check (level_key in ('bronze','silver','gold','diamond')),
  level_order integer not null check (level_order between 1 and 4),
  title text not null check (length(trim(title)) > 0),
  maintenance_attendance integer not null check (maintenance_attendance >= 0),
  promotion_attendance integer,
  min_active_months integer not null default 0 check (min_active_months >= 0),
  max_uncovered_days integer not null check (max_uncovered_days >= 0),
  waitlist_priority integer not null check (waitlist_priority >= 1),
  private_discount_pct integer not null check (private_discount_pct between 0 and 100),
  event_discount_pct integer not null check (event_discount_pct between 0 and 100),
  monthly_guest_invites integer not null default 0 check (monthly_guest_invites >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_status_level_definitions_key_unique unique (studio_id, level_key),
  constraint reward_status_level_definitions_order_unique unique (studio_id, level_order),
  constraint reward_status_level_definitions_promotion_chk check (
    (level_key = 'bronze' and promotion_attendance is null)
    or (level_key <> 'bronze' and promotion_attendance is not null and promotion_attendance > maintenance_attendance)
  )
);

comment on table public.reward_status_level_definitions is
  'SF-255 visible deterministic level requirements and active benefits. No hidden score or points.';

create table public.reward_status_memberships (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  current_level_key text not null default 'bronze'
    check (current_level_key in ('bronze','silver','gold','diamond')),
  activated_on date not null,
  level_effective_from date not null,
  last_closed_period_start date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_status_memberships_student_unique unique (studio_id, student_id)
);

comment on table public.reward_status_memberships is
  'SF-255 current monthly status level. This is mutable and intentionally separate from permanent reward program unlocks.';

create table public.reward_status_months (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  level_key_at_start text not null check (level_key_at_start in ('bronze','silver','gold','diamond')),
  attendance_count integer not null default 0 check (attendance_count >= 0),
  active_months integer not null default 0 check (active_months >= 0),
  max_uncovered_days integer not null default 0 check (max_uncovered_days >= 0),
  maintenance_met boolean not null default false,
  promotion_met boolean not null default false,
  next_level_key text check (next_level_key is null or next_level_key in ('silver','gold','diamond')),
  outcome text not null default 'pending'
    check (outcome in ('pending','maintained','promoted','demoted','floor','partial_month')),
  resulting_level_key text check (
    resulting_level_key is null
    or resulting_level_key in ('bronze','silver','gold','diamond')
  ),
  is_closed boolean not null default false,
  evaluated_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_status_months_period_chk check (
    period_start = date_trunc('month', period_start)::date
    and period_end = (period_start + interval '1 month - 1 day')::date
  ),
  constraint reward_status_months_student_period_unique unique (studio_id, student_id, period_start)
);

comment on table public.reward_status_months is
  'SF-255 monthly evaluation snapshots. Student UI uses the current period prospectively; closed periods are audit only.';

create table public.reward_status_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  period_start date not null,
  event_type text not null check (
    event_type in ('activated','maintained','promoted','demoted','floor','partial_month')
  ),
  from_level_key text check (
    from_level_key is null or from_level_key in ('bronze','silver','gold','diamond')
  ),
  to_level_key text not null check (to_level_key in ('bronze','silver','gold','diamond')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);

comment on table public.reward_status_events is
  'SF-255 internal audit for status transitions. Historical levels are not exposed in the student UI.';

create index reward_status_memberships_student_idx
  on public.reward_status_memberships(studio_id, student_id);
create index reward_status_months_student_idx
  on public.reward_status_months(studio_id, student_id, period_start desc);
create index reward_status_events_student_idx
  on public.reward_status_events(studio_id, student_id, occurred_at desc);

alter table public.reward_status_level_definitions enable row level security;
alter table public.reward_status_memberships enable row level security;
alter table public.reward_status_months enable row level security;
alter table public.reward_status_events enable row level security;

create policy reward_status_level_definitions_read
on public.reward_status_level_definitions
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or exists (
    select 1
    from public.students s
    where s.studio_id = reward_status_level_definitions.studio_id
      and private.is_reward_student_self(s.studio_id, s.id)
  )
);

create policy reward_status_memberships_read
on public.reward_status_memberships
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

create policy reward_status_months_read
on public.reward_status_months
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

create policy reward_status_events_admin_read
on public.reward_status_events
for select
to authenticated
using (private.has_capability(studio_id, 'rewards.read'));

create or replace function private.reward_status_level_order(p_level_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_level_key
    when 'bronze' then 1
    when 'silver' then 2
    when 'gold' then 3
    when 'diamond' then 4
    else null
  end;
$$;

create or replace function private.reward_status_metrics(
  p_student_id uuid,
  p_period_start date,
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
  v_period_end date;
  v_metric_start date;
  v_metric_end date;
  v_current public.reward_status_level_definitions%rowtype;
  v_next public.reward_status_level_definitions%rowtype;
  v_attendance integer := 0;
  v_active_months integer := 0;
  v_max_uncovered integer := 0;
  v_maintenance boolean := false;
  v_promotion boolean := false;
begin
  if p_student_id is null or p_period_start is null or p_as_of is null then
    raise exception 'reward_status_metrics_arguments_required';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_status_student_not_found';
  end if;

  select * into v_membership
  from public.reward_status_memberships
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if not found then
    raise exception 'reward_status_membership_not_found';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_period_end := (p_period_start + interval '1 month - 1 day')::date;
  v_metric_start := greatest(p_period_start, v_membership.activated_on);
  v_metric_end := least(v_period_end, p_as_of);

  select * into v_current
  from public.reward_status_level_definitions d
  where d.studio_id = v_student.studio_id
    and d.level_key = v_membership.current_level_key;

  if not found then
    raise exception 'reward_status_level_definition_not_found';
  end if;

  select * into v_next
  from public.reward_status_level_definitions d
  where d.studio_id = v_student.studio_id
    and d.level_order = v_current.level_order + 1;

  if v_metric_end >= v_metric_start then
    select count(*)::integer
      into v_attendance
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    where r.studio_id = v_student.studio_id
      and r.student_id = v_student.id
      and r.status = 'attended'
      and (cs.starts_at at time zone v_timezone)::date between v_metric_start and v_metric_end;

    with covered_months as (
      select distinct date_trunc('month', gs.covered_day)::date as month_start
      from public.product_acquisitions pa
      cross join lateral generate_series(
        date_trunc('month', pa.starts_on::timestamp)::date,
        date_trunc('month', least(pa.expires_on, p_as_of)::timestamp)::date,
        interval '1 month'
      ) as gs(covered_day)
      where pa.studio_id = v_student.studio_id
        and pa.student_id = v_student.id
        and pa.status = 'active'
        and not pa.access_blocked
        and pa.starts_on is not null
        and pa.expires_on is not null
        and pa.starts_on <= p_as_of
        and pa.expires_on >= pa.starts_on
    )
    select count(*)::integer
      into v_active_months
    from covered_months
    where month_start <= date_trunc('month', p_as_of)::date;

    with days as (
      select gs::date as day
      from generate_series(v_metric_start, v_metric_end, interval '1 day') gs
    ),
    uncovered as (
      select
        d.day,
        d.day - (row_number() over (order by d.day))::integer as grp
      from days d
      where not exists (
        select 1
        from public.product_acquisitions pa
        where pa.studio_id = v_student.studio_id
          and pa.student_id = v_student.id
          and pa.status = 'active'
          and not pa.access_blocked
          and pa.starts_on is not null
          and pa.expires_on is not null
          and pa.starts_on <= d.day
          and pa.expires_on >= d.day
      )
    ),
    runs as (
      select count(*)::integer as run_length
      from uncovered
      group by grp
    )
    select coalesce(max(run_length), 0)::integer
      into v_max_uncovered
    from runs;
  end if;

  v_maintenance :=
    v_attendance >= v_current.maintenance_attendance
    and v_max_uncovered <= v_current.max_uncovered_days;

  v_promotion :=
    v_next.id is not null
    and v_attendance >= coalesce(v_next.promotion_attendance, 2147483647)
    and v_active_months >= v_next.min_active_months
    and v_max_uncovered <= v_next.max_uncovered_days;

  return jsonb_build_object(
    'period_start', p_period_start,
    'period_end', v_period_end,
    'evaluated_through', v_metric_end,
    'attendance_count', v_attendance,
    'active_months', v_active_months,
    'max_uncovered_days', v_max_uncovered,
    'maintenance_met', v_maintenance,
    'promotion_met', v_promotion,
    'current_level', jsonb_build_object(
      'key', v_current.level_key,
      'order', v_current.level_order,
      'title', v_current.title,
      'maintenance_attendance', v_current.maintenance_attendance,
      'max_uncovered_days', v_current.max_uncovered_days,
      'waitlist_priority', v_current.waitlist_priority,
      'private_discount_pct', v_current.private_discount_pct,
      'event_discount_pct', v_current.event_discount_pct,
      'monthly_guest_invites', v_current.monthly_guest_invites
    ),
    'next_level', case
      when v_next.id is null then null
      else jsonb_build_object(
        'key', v_next.level_key,
        'order', v_next.level_order,
        'title', v_next.title,
        'promotion_attendance', v_next.promotion_attendance,
        'min_active_months', v_next.min_active_months,
        'max_uncovered_days', v_next.max_uncovered_days,
        'waitlist_priority', v_next.waitlist_priority,
        'private_discount_pct', v_next.private_discount_pct,
        'event_discount_pct', v_next.event_discount_pct,
        'monthly_guest_invites', v_next.monthly_guest_invites
      )
    end
  );
end;
$$;

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
    p_as_of,
    date_trunc('month', p_as_of)::date
  )
  on conflict (studio_id, student_id) do nothing;

  select * into v_membership
  from public.reward_status_memberships
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

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
    'status_period', date_trunc('month', v_today)::date
  );
end;
$$;

revoke all on function public.student_reward_status_snapshot()
from public, anon;
grant execute on function public.student_reward_status_snapshot()
to authenticated;

revoke all on function private.reward_status_level_order(text)
from public, anon, authenticated, service_role;
revoke all on function private.reward_status_metrics(uuid,date,date)
from public, anon, authenticated, service_role;
revoke all on function private.reward_status_sync_student(uuid,date)
from public, anon, authenticated, service_role;

insert into public.reward_status_level_definitions (
  studio_id,
  level_key,
  level_order,
  title,
  maintenance_attendance,
  promotion_attendance,
  min_active_months,
  max_uncovered_days,
  waitlist_priority,
  private_discount_pct,
  event_discount_pct,
  monthly_guest_invites
)
select
  s.id,
  v.level_key,
  v.level_order,
  v.title,
  v.maintenance_attendance,
  v.promotion_attendance,
  v.min_active_months,
  v.max_uncovered_days,
  v.waitlist_priority,
  v.private_discount_pct,
  v.event_discount_pct,
  v.monthly_guest_invites
from public.studios s
cross join (
  values
    ('bronze', 1, 'Bronce', 4, null::integer, 0, 15, 1, 5, 5, 0),
    ('silver', 2, 'Plata', 6, 8, 2, 10, 2, 10, 10, 0),
    ('gold', 3, 'Oro', 8, 12, 4, 7, 3, 15, 15, 1),
    ('diamond', 4, 'Diamante', 10, 16, 6, 3, 4, 20, 20, 2)
) as v(
  level_key,
  level_order,
  title,
  maintenance_attendance,
  promotion_attendance,
  min_active_months,
  max_uncovered_days,
  waitlist_priority,
  private_discount_pct,
  event_discount_pct,
  monthly_guest_invites
)
on conflict (studio_id, level_key) do nothing;

insert into public.reward_status_memberships (
  studio_id,
  student_id,
  current_level_key,
  activated_on,
  level_effective_from
)
select
  s.studio_id,
  s.id,
  'bronze',
  (clock_timestamp() at time zone coalesce(st.timezone, 'America/Mexico_City'))::date,
  date_trunc(
    'month',
    (clock_timestamp() at time zone coalesce(st.timezone, 'America/Mexico_City'))::date
  )::date
from public.students s
join public.studios st on st.id = s.studio_id
on conflict (studio_id, student_id) do nothing;

insert into public.reward_status_events (
  studio_id,
  student_id,
  period_start,
  event_type,
  from_level_key,
  to_level_key,
  details
)
select
  m.studio_id,
  m.student_id,
  date_trunc('month', m.activated_on)::date,
  'activated',
  null,
  'bronze',
  jsonb_build_object('source', 'sf255_initial_activation')
from public.reward_status_memberships m
where not exists (
  select 1
  from public.reward_status_events e
  where e.studio_id = m.studio_id
    and e.student_id = m.student_id
    and e.event_type = 'activated'
);

create or replace function private.seed_reward_status_for_new_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_activated_on date;
begin
  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = new.studio_id;

  v_activated_on := (new.created_at at time zone v_timezone)::date;

  insert into public.reward_status_memberships (
    studio_id,
    student_id,
    current_level_key,
    activated_on,
    level_effective_from
  )
  values (
    new.studio_id,
    new.id,
    'bronze',
    v_activated_on,
    date_trunc('month', v_activated_on)::date
  )
  on conflict (studio_id, student_id) do nothing;

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
    new.studio_id,
    new.id,
    date_trunc('month', v_activated_on)::date,
    'activated',
    null,
    'bronze',
    jsonb_build_object('source', 'student_created')
  );

  return new;
end;
$$;

revoke all on function private.seed_reward_status_for_new_student()
from public, anon, authenticated, service_role;

drop trigger if exists reward_status_seed_student on public.students;
create trigger reward_status_seed_student
after insert on public.students
for each row execute function private.seed_reward_status_for_new_student();

create or replace function private.seed_reward_status_levels_for_new_studio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_status_level_definitions (
    studio_id,
    level_key,
    level_order,
    title,
    maintenance_attendance,
    promotion_attendance,
    min_active_months,
    max_uncovered_days,
    waitlist_priority,
    private_discount_pct,
    event_discount_pct,
    monthly_guest_invites
  )
  values
    (new.id, 'bronze', 1, 'Bronce', 4, null, 0, 15, 1, 5, 5, 0),
    (new.id, 'silver', 2, 'Plata', 6, 8, 2, 10, 2, 10, 10, 0),
    (new.id, 'gold', 3, 'Oro', 8, 12, 4, 7, 3, 15, 15, 1),
    (new.id, 'diamond', 4, 'Diamante', 10, 16, 6, 3, 4, 20, 20, 2)
  on conflict (studio_id, level_key) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_reward_status_levels_for_new_studio()
from public, anon, authenticated, service_role;

drop trigger if exists reward_status_seed_studio_levels on public.studios;
create trigger reward_status_seed_studio_levels
after insert on public.studios
for each row execute function private.seed_reward_status_levels_for_new_studio();

grant select on public.reward_status_level_definitions to authenticated;
grant select on public.reward_status_memberships to authenticated;
grant select on public.reward_status_months to authenticated;
grant select on public.reward_status_events to authenticated;
