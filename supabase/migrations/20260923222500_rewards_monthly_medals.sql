-- REWARDS · Medallas mensuales
-- Onboarding 6/6 desbloquea acceso al programa; no otorga Bronce.
-- Cada ciclo mensual asigna directamente la Medalla más alta que cumpla:
-- días activos + no show + continuidad + renovación.

alter table public.reward_onboarding
  add column if not exists access_unlocked_at timestamptz,
  add column if not exists access_acknowledged_at timestamptz,
  add column if not exists access_method text,
  add column if not exists access_unlocked_by uuid references auth.users(id) on delete set null,
  add column if not exists access_reason text;

alter table public.reward_onboarding
  drop constraint if exists reward_onboarding_access_method_check,
  add constraint reward_onboarding_access_method_check
    check (access_method is null or access_method in ('onboarding','admin','legacy'));

alter table public.reward_onboarding
  drop constraint if exists reward_onboarding_access_admin_reason_chk,
  add constraint reward_onboarding_access_admin_reason_chk
    check (
      access_method <> 'admin'
      or nullif(trim(coalesce(access_reason,'')), '') is not null
    );

update public.reward_onboarding
set access_unlocked_at = coalesce(access_unlocked_at, completed_at, bronze_unlocked_at),
    access_acknowledged_at = coalesce(
      access_acknowledged_at,
      bronze_acknowledged_at,
      case when unlock_method = 'legacy' then bronze_unlocked_at else null end
    ),
    access_method = coalesce(access_method, unlock_method),
    access_unlocked_by = coalesce(access_unlocked_by, unlocked_by),
    access_reason = coalesce(access_reason, unlock_reason)
where access_unlocked_at is null
   or access_method is null;

comment on column public.reward_onboarding.access_unlocked_at is
  'Momento en que la alumna obtuvo acceso al sistema mensual de Medallas.';

alter table public.reward_status_level_definitions
  add column if not exists required_active_days integer not null default 0
    check (required_active_days >= 0),
  add column if not exists max_no_shows integer not null default 0
    check (max_no_shows >= 0),
  add column if not exists min_continuity_months integer not null default 0
    check (min_continuity_months >= 0),
  add column if not exists max_renewal_gap_days integer not null default 0
    check (max_renewal_gap_days >= 0),
  add column if not exists benefits_definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(benefits_definition) = 'object');

alter table public.reward_status_level_definitions
  drop constraint if exists reward_status_level_definitions_promotion_chk;

update public.reward_status_level_definitions
set required_active_days = case level_key
      when 'bronze' then 6 when 'silver' then 9 when 'gold' then 12 when 'diamond' then 16 end,
    max_no_shows = case level_key
      when 'bronze' then 3 when 'silver' then 2 when 'gold' then 1 when 'diamond' then 0 end,
    min_continuity_months = case level_key
      when 'bronze' then 1 when 'silver' then 2 when 'gold' then 4 when 'diamond' then 6 end,
    max_renewal_gap_days = case level_key
      when 'bronze' then 15 when 'silver' then 10 when 'gold' then 7 when 'diamond' then 5 end,
    -- Campos heredados quedan sincronizados para compatibilidad de lectura.
    maintenance_attendance = case level_key
      when 'bronze' then 6 when 'silver' then 9 when 'gold' then 12 when 'diamond' then 16 end,
    promotion_attendance = null,
    min_active_months = case level_key
      when 'bronze' then 1 when 'silver' then 2 when 'gold' then 4 when 'diamond' then 6 end,
    max_uncovered_days = case level_key
      when 'bronze' then 15 when 'silver' then 10 when 'gold' then 7 when 'diamond' then 5 end,
    waitlist_priority = case level_key
      when 'bronze' then 1 when 'silver' then 2 when 'gold' then 3 when 'diamond' then 4 end,
    private_discount_pct = case level_key
      when 'bronze' then 0 when 'silver' then 0 when 'gold' then 15 when 'diamond' then 20 end,
    event_discount_pct = case level_key
      when 'bronze' then 5 when 'silver' then 10 when 'gold' then 15 when 'diamond' then 20 end,
    monthly_guest_invites = case level_key
      when 'bronze' then 0 when 'silver' then 0 when 'gold' then 1 when 'diamond' then 2 end,
    benefits_definition = case level_key
      when 'bronze' then jsonb_build_object(
        'waitlist_priority_label','Prioridad básica',
        'event_discount_pct',5,
        'private_discount_pct',0,
        'monthly_guest_invites',0,
        'early_access',false,
        'premium_experiences',false
      )
      when 'silver' then jsonb_build_object(
        'waitlist_priority_label','Prioridad mayor',
        'event_discount_pct',10,
        'private_discount_pct',0,
        'monthly_guest_invites',0,
        'early_access',true,
        'exclusive_promotions',true,
        'premium_experiences',false
      )
      when 'gold' then jsonb_build_object(
        'waitlist_priority_label','Prioridad alta',
        'event_discount_pct',15,
        'private_discount_pct',15,
        'monthly_guest_invites',1,
        'early_access',true,
        'exclusive_promotions',true,
        'premium_experiences',false
      )
      when 'diamond' then jsonb_build_object(
        'waitlist_priority_label','Prioridad máxima',
        'event_discount_pct',20,
        'private_discount_pct',20,
        'monthly_guest_invites',2,
        'early_access',true,
        'exclusive_promotions',true,
        'premium_experiences',true
      )
    end,
    updated_at = now();

alter table public.reward_status_memberships
  alter column current_level_key drop not null;

alter table public.reward_status_memberships
  drop constraint if exists reward_status_memberships_current_level_key_check,
  add constraint reward_status_memberships_current_level_key_check
    check (
      current_level_key is null
      or current_level_key in ('bronze','silver','gold','diamond')
    );

alter table public.reward_status_months
  alter column level_key_at_start drop not null,
  add column if not exists active_days integer not null default 0 check (active_days >= 0),
  add column if not exists no_show_count integer not null default 0 check (no_show_count >= 0),
  add column if not exists continuity_months integer not null default 0 check (continuity_months >= 0),
  add column if not exists continuity_started_on date,
  add column if not exists renewal_gap_days integer not null default 0 check (renewal_gap_days >= 0),
  add column if not exists eligible_level_key text,
  add column if not exists requirements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requirements) = 'object');

alter table public.reward_status_months
  drop constraint if exists reward_status_months_level_key_at_start_check,
  add constraint reward_status_months_level_key_at_start_check
    check (
      level_key_at_start is null
      or level_key_at_start in ('bronze','silver','gold','diamond')
    );

alter table public.reward_status_months
  drop constraint if exists reward_status_months_outcome_check,
  add constraint reward_status_months_outcome_check
    check (
      outcome in (
        'pending','maintained','promoted','demoted','floor','partial_month',
        'awarded','no_medal'
      )
    );

alter table public.reward_status_months
  drop constraint if exists reward_status_months_eligible_level_key_check,
  add constraint reward_status_months_eligible_level_key_check
    check (
      eligible_level_key is null
      or eligible_level_key in ('bronze','silver','gold','diamond')
    );

alter table public.reward_status_events
  alter column to_level_key drop not null;

alter table public.reward_status_events
  drop constraint if exists reward_status_events_to_level_key_check,
  add constraint reward_status_events_to_level_key_check
    check (
      to_level_key is null
      or to_level_key in ('bronze','silver','gold','diamond')
    );

alter table public.reward_status_events
  drop constraint if exists reward_status_events_event_type_check,
  add constraint reward_status_events_event_type_check
    check (
      event_type in (
        'activated','maintained','promoted','demoted','floor','partial_month',
        'access_unlocked','evaluated'
      )
    );

create or replace function private.reward_status_continuity(
  p_student_id uuid,
  p_as_of date,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_attendance date;
  v_start date;
  v_months integer := 0;
begin
  with attendance_days as (
    select distinct (cs.starts_at at time zone p_timezone)::date as day
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    where r.student_id = p_student_id
      and r.status = 'attended'
      and (cs.starts_at at time zone p_timezone)::date <= p_as_of
  )
  select max(day) into v_last_attendance
  from attendance_days;

  -- 30 días consecutivos sin attended reinician la continuidad.
  if v_last_attendance is null or (p_as_of - v_last_attendance) >= 30 then
    return jsonb_build_object(
      'months', 0,
      'started_on', null,
      'last_attendance_on', v_last_attendance,
      'active', false
    );
  end if;

  with attendance_days as (
    select distinct (cs.starts_at at time zone p_timezone)::date as day
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    where r.student_id = p_student_id
      and r.status = 'attended'
      and (cs.starts_at at time zone p_timezone)::date <= p_as_of
  ),
  ordered as (
    select day, lag(day) over (order by day) as previous_day
    from attendance_days
  )
  select day into v_start
  from ordered
  where previous_day is null
     or (day - previous_day) > 30
  order by day desc
  limit 1;

  v_months := greatest(0, floor((p_as_of - v_start)::numeric / 30)::integer);

  return jsonb_build_object(
    'months', v_months,
    'started_on', v_start,
    'last_attendance_on', v_last_attendance,
    'active', true
  );
end;
$$;

revoke all on function private.reward_status_continuity(uuid,date,text)
from public, anon, authenticated, service_role;

create or replace function private.reward_status_renewal_gap_days(
  p_student_id uuid,
  p_as_of date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_id uuid;
  v_latest_start date;
  v_latest_expiry date;
  v_previous_expiry date;
  v_gap integer := 0;
begin
  select pa.id, pa.starts_on, pa.expires_on
    into v_latest_id, v_latest_start, v_latest_expiry
  from public.product_acquisitions pa
  where pa.student_id = p_student_id
    and pa.status in ('active','expired')
    and not pa.access_blocked
    and pa.starts_on is not null
    and pa.expires_on is not null
    and pa.starts_on <= p_as_of
  order by pa.starts_on desc, pa.created_at desc, pa.id desc
  limit 1;

  if v_latest_id is null then
    return 0;
  end if;

  select max(pa.expires_on)
    into v_previous_expiry
  from public.product_acquisitions pa
  where pa.student_id = p_student_id
    and pa.id <> v_latest_id
    and pa.status in ('active','expired')
    and not pa.access_blocked
    and pa.starts_on is not null
    and pa.expires_on is not null
    and pa.starts_on < v_latest_start;

  if v_previous_expiry is not null then
    v_gap := greatest(0, v_latest_start - v_previous_expiry);
  end if;

  -- Si aún no renueva un paquete vencido, el contador sigue creciendo.
  if v_latest_expiry < p_as_of then
    v_gap := greatest(v_gap, p_as_of - v_latest_expiry);
  end if;

  return v_gap;
end;
$$;

revoke all on function private.reward_status_renewal_gap_days(uuid,date)
from public, anon, authenticated, service_role;

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
  v_attendance_count integer := 0;
  v_active_days integer := 0;
  v_no_show_count integer := 0;
  v_continuity jsonb := '{}'::jsonb;
  v_continuity_months integer := 0;
  v_continuity_started_on date;
  v_renewal_gap_days integer := 0;
  v_current public.reward_status_level_definitions%rowtype;
  v_eligible public.reward_status_level_definitions%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_levels jsonb := '{}'::jsonb;
  v_level_eligible boolean;
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

  if v_membership.current_level_key is not null then
    select * into v_current
    from public.reward_status_level_definitions d
    where d.studio_id = v_student.studio_id
      and d.level_key = v_membership.current_level_key;
  end if;

  if v_metric_end >= v_metric_start then
    select count(*)::integer,
           count(distinct (cs.starts_at at time zone v_timezone)::date)::integer
      into v_attendance_count, v_active_days
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    where r.studio_id = v_student.studio_id
      and r.student_id = v_student.id
      and r.status = 'attended'
      and (cs.starts_at at time zone v_timezone)::date between v_metric_start and v_metric_end;

    select count(*)::integer
      into v_no_show_count
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    where r.studio_id = v_student.studio_id
      and r.student_id = v_student.id
      and r.status = 'no_show'
      and (cs.starts_at at time zone v_timezone)::date between v_metric_start and v_metric_end;
  end if;

  v_continuity := private.reward_status_continuity(v_student.id, v_metric_end, v_timezone);
  v_continuity_months := coalesce((v_continuity->>'months')::integer, 0);
  v_continuity_started_on := nullif(v_continuity->>'started_on','')::date;
  v_renewal_gap_days := private.reward_status_renewal_gap_days(v_student.id, v_metric_end);

  -- Se evalúan las cuatro Medallas de mayor a menor; no existe escalera.
  for v_level in
    select *
    from public.reward_status_level_definitions d
    where d.studio_id = v_student.studio_id
    order by d.level_order desc
  loop
    v_level_eligible :=
      v_active_days >= v_level.required_active_days
      and v_no_show_count <= v_level.max_no_shows
      and v_continuity_months >= v_level.min_continuity_months
      and v_renewal_gap_days <= v_level.max_renewal_gap_days;

    v_levels := v_levels || jsonb_build_object(
      v_level.level_key,
      jsonb_build_object(
        'key', v_level.level_key,
        'order', v_level.level_order,
        'title', v_level.title,
        'required_active_days', v_level.required_active_days,
        'max_no_shows', v_level.max_no_shows,
        'min_continuity_months', v_level.min_continuity_months,
        'max_renewal_gap_days', v_level.max_renewal_gap_days,
        'active_days', v_active_days,
        'no_show_count', v_no_show_count,
        'continuity_months', v_continuity_months,
        'renewal_gap_days', v_renewal_gap_days,
        'active_days_met', v_active_days >= v_level.required_active_days,
        'no_show_met', v_no_show_count <= v_level.max_no_shows,
        'continuity_met', v_continuity_months >= v_level.min_continuity_months,
        'renewal_met', v_renewal_gap_days <= v_level.max_renewal_gap_days,
        'eligible', v_level_eligible,
        'waitlist_priority', v_level.waitlist_priority,
        'private_discount_pct', v_level.private_discount_pct,
        'event_discount_pct', v_level.event_discount_pct,
        'monthly_guest_invites', v_level.monthly_guest_invites,
        'benefits_definition', v_level.benefits_definition
      )
    );

    if v_level_eligible and v_eligible.id is null then
      v_eligible := v_level;
    end if;
  end loop;

  return jsonb_build_object(
    'period_start', p_period_start,
    'period_end', v_period_end,
    'evaluated_through', v_metric_end,
    'attendance_count', v_attendance_count,
    'active_days', v_active_days,
    'no_show_count', v_no_show_count,
    'continuity_months', v_continuity_months,
    'continuity_started_on', v_continuity_started_on,
    'last_attendance_on', v_continuity->>'last_attendance_on',
    'renewal_gap_days', v_renewal_gap_days,
    'levels', v_levels,
    'projected_medal', case
      when v_eligible.id is null then null
      else v_levels->v_eligible.level_key
    end,
    'eligible_level_key', case
      when v_eligible.id is null then null
      else v_eligible.level_key
    end,
    'current_medal', case
      when v_current.id is null then null
      else jsonb_build_object(
        'key', v_current.level_key,
        'order', v_current.level_order,
        'title', v_current.title,
        'required_active_days', v_current.required_active_days,
        'max_no_shows', v_current.max_no_shows,
        'min_continuity_months', v_current.min_continuity_months,
        'max_renewal_gap_days', v_current.max_renewal_gap_days,
        'waitlist_priority', v_current.waitlist_priority,
        'private_discount_pct', v_current.private_discount_pct,
        'event_discount_pct', v_current.event_discount_pct,
        'monthly_guest_invites', v_current.monthly_guest_invites,
        'benefits_definition', v_current.benefits_definition
      )
    end,
    -- Alias temporal para consumidores anteriores.
    'current_level', case
      when v_current.id is null then null
      else jsonb_build_object(
        'key', v_current.level_key,
        'order', v_current.level_order,
        'title', v_current.title,
        'required_active_days', v_current.required_active_days,
        'max_no_shows', v_current.max_no_shows,
        'min_continuity_months', v_current.min_continuity_months,
        'max_renewal_gap_days', v_current.max_renewal_gap_days,
        'waitlist_priority', v_current.waitlist_priority,
        'private_discount_pct', v_current.private_discount_pct,
        'event_discount_pct', v_current.event_discount_pct,
        'monthly_guest_invites', v_current.monthly_guest_invites,
        'benefits_definition', v_current.benefits_definition
      )
    end,
    'next_level', null,
    'maintenance_met', v_eligible.id is not null,
    'promotion_met', false
  );
end;
$$;

revoke all on function private.reward_status_metrics(uuid,date,date)
from public, anon, authenticated, service_role;

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
  v_current_period date;
  v_period date;
  v_period_end date;
  v_metrics jsonb;
  v_from_level text;
  v_to_level text;
  v_outcome text;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_status_student_not_found';
  end if;

  select * into v_membership
  from public.reward_status_memberships
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if not found then
    return jsonb_build_object(
      'not_activated', true,
      'access_unlocked', false,
      'current_medal', null,
      'current_level', null,
      'projected_medal', null,
      'eligible_level_key', null,
      'active_days', 0,
      'no_show_count', 0,
      'continuity_months', 0,
      'renewal_gap_days', 0,
      'levels', '{}'::jsonb
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

    v_to_level := nullif(v_metrics->>'eligible_level_key','');
    v_outcome := case when v_to_level is null then 'no_medal' else 'awarded' end;

    insert into public.reward_status_months(
      studio_id, student_id, period_start, period_end,
      level_key_at_start, attendance_count, active_months, max_uncovered_days,
      maintenance_met, promotion_met, next_level_key,
      outcome, resulting_level_key, is_closed, evaluated_at, closed_at,
      active_days, no_show_count, continuity_months, continuity_started_on,
      renewal_gap_days, eligible_level_key, requirements
    )
    values(
      v_student.studio_id,
      v_student.id,
      v_period,
      v_period_end,
      v_from_level,
      coalesce((v_metrics->>'attendance_count')::integer,0),
      coalesce((v_metrics->>'continuity_months')::integer,0),
      coalesce((v_metrics->>'renewal_gap_days')::integer,0),
      v_to_level is not null,
      false,
      null,
      v_outcome,
      v_to_level,
      true,
      now(),
      now(),
      coalesce((v_metrics->>'active_days')::integer,0),
      coalesce((v_metrics->>'no_show_count')::integer,0),
      coalesce((v_metrics->>'continuity_months')::integer,0),
      nullif(v_metrics->>'continuity_started_on','')::date,
      coalesce((v_metrics->>'renewal_gap_days')::integer,0),
      v_to_level,
      coalesce(v_metrics->'levels','{}'::jsonb)
    )
    on conflict (studio_id,student_id,period_start)
    do update set
      period_end = excluded.period_end,
      level_key_at_start = excluded.level_key_at_start,
      attendance_count = excluded.attendance_count,
      active_months = excluded.active_months,
      max_uncovered_days = excluded.max_uncovered_days,
      maintenance_met = excluded.maintenance_met,
      promotion_met = false,
      next_level_key = null,
      outcome = excluded.outcome,
      resulting_level_key = excluded.resulting_level_key,
      is_closed = true,
      evaluated_at = now(),
      closed_at = coalesce(public.reward_status_months.closed_at,now()),
      active_days = excluded.active_days,
      no_show_count = excluded.no_show_count,
      continuity_months = excluded.continuity_months,
      continuity_started_on = excluded.continuity_started_on,
      renewal_gap_days = excluded.renewal_gap_days,
      eligible_level_key = excluded.eligible_level_key,
      requirements = excluded.requirements,
      updated_at = now();

    insert into public.reward_status_events(
      studio_id,student_id,period_start,event_type,
      from_level_key,to_level_key,details
    )
    values(
      v_student.studio_id,
      v_student.id,
      v_period,
      'evaluated',
      v_from_level,
      v_to_level,
      jsonb_build_object(
        'outcome', v_outcome,
        'active_days', coalesce((v_metrics->>'active_days')::integer,0),
        'no_show_count', coalesce((v_metrics->>'no_show_count')::integer,0),
        'continuity_months', coalesce((v_metrics->>'continuity_months')::integer,0),
        'continuity_started_on', v_metrics->>'continuity_started_on',
        'renewal_gap_days', coalesce((v_metrics->>'renewal_gap_days')::integer,0),
        'requirements', coalesce(v_metrics->'levels','{}'::jsonb)
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

  insert into public.reward_status_months(
    studio_id, student_id, period_start, period_end,
    level_key_at_start, attendance_count, active_months, max_uncovered_days,
    maintenance_met, promotion_met, next_level_key,
    outcome, resulting_level_key, is_closed, evaluated_at, closed_at,
    active_days, no_show_count, continuity_months, continuity_started_on,
    renewal_gap_days, eligible_level_key, requirements
  )
  values(
    v_student.studio_id,
    v_student.id,
    v_current_period,
    (v_current_period + interval '1 month - 1 day')::date,
    v_from_level,
    coalesce((v_metrics->>'attendance_count')::integer,0),
    coalesce((v_metrics->>'continuity_months')::integer,0),
    coalesce((v_metrics->>'renewal_gap_days')::integer,0),
    nullif(v_metrics->>'eligible_level_key','') is not null,
    false,
    null,
    'pending',
    null,
    false,
    now(),
    null,
    coalesce((v_metrics->>'active_days')::integer,0),
    coalesce((v_metrics->>'no_show_count')::integer,0),
    coalesce((v_metrics->>'continuity_months')::integer,0),
    nullif(v_metrics->>'continuity_started_on','')::date,
    coalesce((v_metrics->>'renewal_gap_days')::integer,0),
    nullif(v_metrics->>'eligible_level_key',''),
    coalesce(v_metrics->'levels','{}'::jsonb)
  )
  on conflict (studio_id,student_id,period_start)
  do update set
    period_end = excluded.period_end,
    level_key_at_start = excluded.level_key_at_start,
    attendance_count = excluded.attendance_count,
    active_months = excluded.active_months,
    max_uncovered_days = excluded.max_uncovered_days,
    maintenance_met = excluded.maintenance_met,
    promotion_met = false,
    next_level_key = null,
    outcome = 'pending',
    resulting_level_key = null,
    is_closed = false,
    evaluated_at = now(),
    closed_at = null,
    active_days = excluded.active_days,
    no_show_count = excluded.no_show_count,
    continuity_months = excluded.continuity_months,
    continuity_started_on = excluded.continuity_started_on,
    renewal_gap_days = excluded.renewal_gap_days,
    eligible_level_key = excluded.eligible_level_key,
    requirements = excluded.requirements,
    updated_at = now();

  return v_metrics;
end;
$$;

revoke all on function private.reward_status_sync_student(uuid,date)
from public, anon, authenticated, service_role;

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

  if not found then
    raise exception 'reward_onboarding_student_not_found';
  end if;

  insert into public.reward_onboarding(studio_id,student_id)
  values(v_student.studio_id,v_student.id)
  on conflict(studio_id,student_id) do nothing;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if v_onboarding.access_unlocked_at is not null then
    return jsonb_build_object(
      'access_unlocked',true,
      'created',false,
      'method',v_onboarding.access_method
    );
  end if;

  -- Membresías previas se consideran legado y conservan su Medalla.
  if exists(
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) then
    update public.reward_onboarding
    set access_unlocked_at = coalesce(access_unlocked_at,now()),
        access_acknowledged_at = coalesce(access_acknowledged_at,now()),
        access_method = coalesce(access_method,'legacy'),
        completed_at = coalesce(completed_at,now()),
        updated_at = now()
    where studio_id = v_student.studio_id
      and student_id = v_student.id;

    return jsonb_build_object(
      'access_unlocked',true,
      'created',false,
      'method','legacy'
    );
  end if;

  if v_onboarding.documents_completed_at is null
     or v_onboarding.profile_completed_at is null
     or v_onboarding.app_installed_at is null
     or v_onboarding.notifications_enabled_at is null
     or v_onboarding.first_reservation_at is null
     or v_onboarding.first_attendance_at is null then
    return jsonb_build_object(
      'access_unlocked',false,
      'created',false,
      'method',null
    );
  end if;

  select coalesce(s.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_status_memberships(
    studio_id,student_id,current_level_key,activated_on,level_effective_from
  )
  values(
    v_student.studio_id,
    v_student.id,
    null,
    v_activated_on,
    date_trunc('month',v_activated_on)::date
  )
  on conflict(studio_id,student_id) do nothing
  returning true into v_created;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at,now()),
      access_unlocked_at = coalesce(access_unlocked_at,now()),
      access_method = coalesce(access_method,'onboarding'),
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if coalesce(v_created,false) then
    insert into public.reward_status_events(
      studio_id,student_id,period_start,event_type,
      from_level_key,to_level_key,details
    )
    values(
      v_student.studio_id,
      v_student.id,
      date_trunc('month',v_activated_on)::date,
      'access_unlocked',
      null,
      null,
      jsonb_build_object(
        'source','reward_onboarding',
        'documents_completed_at',v_onboarding.documents_completed_at,
        'profile_completed_at',v_onboarding.profile_completed_at,
        'app_installed_at',v_onboarding.app_installed_at,
        'notifications_enabled_at',v_onboarding.notifications_enabled_at,
        'first_reservation_at',v_onboarding.first_reservation_at,
        'first_attendance_at',v_onboarding.first_attendance_at
      )
    );
  end if;

  return jsonb_build_object(
    'access_unlocked',true,
    'created',coalesce(v_created,false),
    'method','onboarding'
  );
end;
$$;

revoke all on function private.reward_onboarding_try_unlock(uuid)
from public, anon, authenticated, service_role;

create or replace function public.student_acknowledge_medals_access()
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
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student_id is null then
    raise exception 'student_context_not_found';
  end if;

  update public.reward_onboarding o
  set access_acknowledged_at = coalesce(o.access_acknowledged_at,now()),
      updated_at = now()
  where o.student_id = v_student_id
    and o.access_unlocked_at is not null;

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.student_acknowledge_medals_access()
from public, anon;
grant execute on function public.student_acknowledge_medals_access()
to authenticated;

-- Alias temporal para clientes del preview anterior.
create or replace function public.student_acknowledge_bronze_unlock()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.student_acknowledge_medals_access();
$$;

revoke all on function public.student_acknowledge_bronze_unlock()
from public, anon;
grant execute on function public.student_acknowledge_bronze_unlock()
to authenticated;

create or replace function private.admin_unlock_medals_access_internal(
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
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_created boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if v_reason is null then raise exception 'reward_onboarding_reason_required'; end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then raise exception 'student_not_found'; end if;

  if not private.has_capability(v_student.studio_id,'rewards.manage') then
    raise exception 'forbidden';
  end if;

  select coalesce(s.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  insert into public.reward_onboarding(studio_id,student_id)
  values(v_student.studio_id,v_student.id)
  on conflict(studio_id,student_id) do nothing;

  insert into public.reward_status_memberships(
    studio_id,student_id,current_level_key,activated_on,level_effective_from
  )
  values(
    v_student.studio_id,
    v_student.id,
    null,
    v_activated_on,
    date_trunc('month',v_activated_on)::date
  )
  on conflict(studio_id,student_id) do nothing
  returning true into v_created;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at,now()),
      access_unlocked_at = coalesce(access_unlocked_at,now()),
      access_method = case when access_unlocked_at is null then 'admin' else access_method end,
      access_unlocked_by = case
        when access_unlocked_at is null then (select auth.uid())
        else access_unlocked_by
      end,
      access_reason = case
        when access_unlocked_at is null then v_reason
        else access_reason
      end,
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  if coalesce(v_created,false) then
    insert into public.reward_status_events(
      studio_id,student_id,period_start,event_type,
      from_level_key,to_level_key,details
    )
    values(
      v_student.studio_id,
      v_student.id,
      date_trunc('month',v_activated_on)::date,
      'access_unlocked',
      null,
      null,
      jsonb_build_object(
        'source','reward_onboarding_admin',
        'reason',v_reason,
        'admin_user_id',(select auth.uid())
      )
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'created',coalesce(v_created,false),
    'access_unlocked',true
  );
end;
$$;

revoke all on function private.admin_unlock_medals_access_internal(uuid,text)
from public, anon, service_role;
grant execute on function private.admin_unlock_medals_access_internal(uuid,text)
to authenticated;

create or replace function public.admin_unlock_medals_access(
  p_student_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_unlock_medals_access_internal(p_student_id,p_reason);
$$;

revoke all on function public.admin_unlock_medals_access(uuid,text)
from public, anon;
grant execute on function public.admin_unlock_medals_access(uuid,text)
to authenticated;

-- El RPC anterior deja de otorgar Bronce; se conserva solo como alias transitorio.
create or replace function public.admin_grant_bronze_medal(
  p_student_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.admin_unlock_medals_access(p_student_id,p_reason);
$$;

revoke all on function public.admin_grant_bronze_medal(uuid,text)
from public, anon;
grant execute on function public.admin_grant_bronze_medal(uuid,text)
to authenticated;

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
  v_onboarding public.reward_onboarding%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_metrics := private.reward_status_sync_student(v_student.id,v_today);

  return v_metrics || jsonb_build_object(
    'student_id',v_student.id,
    'studio_id',v_student.studio_id,
    'access_unlocked',v_onboarding.access_unlocked_at is not null,
    'access_unlocked_at',v_onboarding.access_unlocked_at,
    'level_key',v_metrics->'current_medal'->>'key',
    'level_title',v_metrics->'current_medal'->>'title',
    'medal_key',v_metrics->'current_medal'->>'key',
    'medal_title',v_metrics->'current_medal'->>'title',
    'status_period',date_trunc('month',v_today)::date
  );
end;
$$;

revoke all on function public.student_reward_status_snapshot()
from public, anon;
grant execute on function public.student_reward_status_snapshot()
to authenticated;

-- Filas de Sandbox creadas solo por el onboarding/admin anterior dejan de
-- conservar Bronce si nunca cerraron una evaluación mensual.
update public.reward_status_memberships m
set current_level_key = null,
    updated_at = now()
from public.reward_onboarding o
where o.studio_id = m.studio_id
  and o.student_id = m.student_id
  and coalesce(o.access_method,o.unlock_method) in ('onboarding','admin')
  and m.last_closed_period_start is null;


-- Alumnas sin Medalla siguen participando en lista de espera con prioridad base 0.
-- Una Medalla vigente únicamente eleva su prioridad relativa.
create or replace function private.promote_waitlist_for_session(
  p_session_id uuid
)
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
      coalesce(d.level_order, 0) as medal_order,
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
