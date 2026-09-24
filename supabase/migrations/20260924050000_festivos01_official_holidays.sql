-- FESTIVOS-01 · official Mexican holidays integrated into the existing Studio Flow calendar.
-- Source of truth: Ley Federal del Trabajo, artículo 74 (official Gobierno de México source).
-- Ordinary election days are intentionally not generated because their date is determined by
-- federal/local electoral law and must be added when an official dated source exists.

create table if not exists public.official_holidays (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'MX',
  holiday_code text not null,
  holiday_date date not null,
  name text not null,
  theme_key text not null,
  default_message text not null,
  source_label text not null,
  source_url text not null,
  legal_basis text not null default 'Ley Federal del Trabajo · Artículo 74',
  source_checked_at timestamptz not null default clock_timestamp(),
  is_official boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint official_holidays_country_code_nonempty check (length(trim(country_code)) > 0),
  constraint official_holidays_code_nonempty check (length(trim(holiday_code)) > 0),
  constraint official_holidays_name_nonempty check (length(trim(name)) > 0),
  constraint official_holidays_theme_nonempty check (length(trim(theme_key)) > 0),
  unique (country_code, holiday_code, holiday_date)
);

create index if not exists official_holidays_country_date_idx
  on public.official_holidays(country_code, holiday_date);

create table if not exists public.studio_holiday_overrides (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  official_holiday_id uuid not null references public.official_holidays(id) on delete restrict,
  holiday_date date not null,
  operation_mode text not null default 'normal',
  student_message text,
  special_recurring_schedule_ids uuid[] not null default '{}'::uuid[],
  configured_by uuid,
  configured_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint studio_holiday_operation_mode_check
    check (operation_mode in ('normal', 'closed', 'special')),
  unique (studio_id, holiday_date)
);

create index if not exists studio_holiday_overrides_studio_date_idx
  on public.studio_holiday_overrides(studio_id, holiday_date);

create table if not exists public.studio_holiday_override_history (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  official_holiday_id uuid not null references public.official_holidays(id) on delete restrict,
  holiday_date date not null,
  operation_mode text not null,
  student_message text,
  special_recurring_schedule_ids uuid[] not null default '{}'::uuid[],
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint studio_holiday_history_operation_mode_check
    check (operation_mode in ('normal', 'closed', 'special'))
);

create index if not exists studio_holiday_history_studio_date_idx
  on public.studio_holiday_override_history(studio_id, holiday_date, created_at desc);

alter table public.class_sessions
  add column if not exists holiday_override_id uuid
    references public.studio_holiday_overrides(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.official_holidays enable row level security;
alter table public.studio_holiday_overrides enable row level security;
alter table public.studio_holiday_override_history enable row level security;

grant select on public.official_holidays to authenticated;
grant select on public.studio_holiday_overrides to authenticated;
grant select on public.studio_holiday_override_history to authenticated;

drop policy if exists official_holidays_read on public.official_holidays;
create policy official_holidays_read
on public.official_holidays
for select
to authenticated
using (is_official);

drop policy if exists studio_holiday_overrides_admin_read on public.studio_holiday_overrides;
create policy studio_holiday_overrides_admin_read
on public.studio_holiday_overrides
for select
to authenticated
using ((select private.has_capability(studio_id, 'schedule.read')));

drop policy if exists studio_holiday_history_admin_read on public.studio_holiday_override_history;
create policy studio_holiday_history_admin_read
on public.studio_holiday_override_history
for select
to authenticated
using ((select private.has_capability(studio_id, 'schedule.read')));

create or replace function private.refresh_mexico_official_holidays(
  p_start_year integer,
  p_end_year integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  y integer;
  first_feb date;
  first_mar date;
  first_nov date;
  first_monday_feb date;
  first_monday_mar date;
  first_monday_nov date;
  v_rows integer := 0;
  v_inserted integer;
  v_source_url text :=
    'https://www.gob.mx/profedet/articulos/sabes-cuales-son-los-dias-de-descanso-obligatorio-para-este-2026';
  v_source_label text := 'Gobierno de México · PROFEDET · Art. 74 LFT';
begin
  if p_start_year is null
     or p_end_year is null
     or p_start_year < 2024
     or p_end_year < p_start_year
     or p_end_year - p_start_year > 30 then
    raise exception 'holiday_year_range_invalid';
  end if;

  for y in p_start_year..p_end_year loop
    first_feb := make_date(y, 2, 1);
    first_mar := make_date(y, 3, 1);
    first_nov := make_date(y, 11, 1);

    first_monday_feb :=
      first_feb + ((8 - extract(isodow from first_feb)::integer) % 7);
    first_monday_mar :=
      first_mar + ((8 - extract(isodow from first_mar)::integer) % 7);
    first_monday_nov :=
      first_nov + ((8 - extract(isodow from first_nov)::integer) % 7);

    insert into public.official_holidays (
      country_code, holiday_code, holiday_date, name, theme_key, default_message,
      source_label, source_url, legal_basis, source_checked_at, updated_at
    )
    values
      (
        'MX', 'new_year', make_date(y, 1, 1), 'Año Nuevo', 'new_year',
        'Comenzamos un nuevo año con energía renovada. Nos vemos pronto en el estudio. ¡Feliz Año Nuevo!',
        v_source_label, v_source_url, 'LFT Art. 74 fracción I', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'constitution', first_monday_feb, 'Conmemoración de la Constitución', 'constitution',
        'Hoy conmemoramos una fecha importante para México. Nos vemos pronto en el estudio.',
        v_source_label, v_source_url, 'LFT Art. 74 fracción II', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'benito_juarez', first_monday_mar + 14, 'Natalicio de Benito Juárez', 'benito_juarez',
        'Hoy conmemoramos el legado de Benito Juárez. Nos vemos pronto en el estudio.',
        v_source_label, v_source_url, 'LFT Art. 74 fracción III', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'labor_day', make_date(y, 5, 1), 'Día del Trabajo', 'labor_day',
        'Hoy reconocemos el esfuerzo, la constancia y el trabajo que impulsa cada meta. Nos vemos pronto en el estudio.',
        v_source_label, v_source_url, 'LFT Art. 74 fracción IV', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'independence', make_date(y, 9, 16), 'Día de la Independencia', 'independence',
        'Hoy conmemoramos la libertad, la historia y todo lo que nos impulsa a seguir avanzando. Nos vemos pronto en el estudio.',
        v_source_label, v_source_url, 'LFT Art. 74 fracción V', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'revolution', first_monday_nov + 14, 'Revolución Mexicana', 'revolution',
        'Hoy conmemoramos la historia, la lucha y la transformación que marcaron a México. Nos vemos pronto en el estudio.',
        v_source_label, v_source_url, 'LFT Art. 74 fracción VI', clock_timestamp(), clock_timestamp()
      ),
      (
        'MX', 'christmas', make_date(y, 12, 25), 'Navidad', 'christmas',
        'Te deseamos una temporada llena de paz, descanso y momentos especiales. Nos vemos pronto en el estudio. ¡Feliz Navidad!',
        v_source_label, v_source_url, 'LFT Art. 74 fracción VIII', clock_timestamp(), clock_timestamp()
      )
    on conflict (country_code, holiday_code, holiday_date)
    do update set
      name = excluded.name,
      theme_key = excluded.theme_key,
      default_message = excluded.default_message,
      source_label = excluded.source_label,
      source_url = excluded.source_url,
      legal_basis = excluded.legal_basis,
      source_checked_at = excluded.source_checked_at,
      is_official = true,
      updated_at = excluded.updated_at;

    get diagnostics v_inserted = row_count;
    v_rows := v_rows + v_inserted;

    if mod(y - 2024, 6) = 0 then
      insert into public.official_holidays (
        country_code, holiday_code, holiday_date, name, theme_key, default_message,
        source_label, source_url, legal_basis, source_checked_at, updated_at
      )
      values (
        'MX',
        'executive_transfer',
        make_date(y, 10, 1),
        'Transmisión del Poder Ejecutivo Federal',
        'executive_transfer',
        'Hoy se realiza la transmisión del Poder Ejecutivo Federal. Nos vemos pronto en el estudio.',
        v_source_label,
        v_source_url,
        'LFT Art. 74 fracción VII',
        clock_timestamp(),
        clock_timestamp()
      )
      on conflict (country_code, holiday_code, holiday_date)
      do update set
        name = excluded.name,
        theme_key = excluded.theme_key,
        default_message = excluded.default_message,
        source_label = excluded.source_label,
        source_url = excluded.source_url,
        legal_basis = excluded.legal_basis,
        source_checked_at = excluded.source_checked_at,
        is_official = true,
        updated_at = excluded.updated_at;

      get diagnostics v_inserted = row_count;
      v_rows := v_rows + v_inserted;
    end if;
  end loop;

  return v_rows;
end;
$$;

revoke all on function private.refresh_mexico_official_holidays(integer, integer)
from public, anon, authenticated, service_role;

select private.refresh_mexico_official_holidays(2026, 2042);

create or replace function public.admin_configure_holiday(
  target_studio_id uuid,
  target_date date,
  p_operation_mode text,
  p_student_message text default null,
  p_keep_session_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holiday public.official_holidays%rowtype;
  v_override public.studio_holiday_overrides%rowtype;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
  v_reason text;
  v_keep_session_ids uuid[] := coalesce(p_keep_session_ids, '{}'::uuid[]);
  v_keep_schedule_ids uuid[] := '{}'::uuid[];
  v_session_count integer := 0;
  v_reservation_count integer := 0;
  v_coach_count integer := 0;
  v_space_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_studio_id is null or target_date is null then
    raise exception 'holiday_target_required';
  end if;

  if p_operation_mode not in ('normal', 'closed', 'special') then
    raise exception 'holiday_operation_invalid';
  end if;

  if not private.has_capability(target_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  select *
    into v_holiday
  from public.official_holidays
  where country_code = 'MX'
    and holiday_date = target_date
    and is_official
  order by created_at
  limit 1;

  if not found then
    raise exception 'official_holiday_not_found';
  end if;

  select timezone
    into v_timezone
  from public.studios
  where id = target_studio_id;

  if v_timezone is null then
    raise exception 'studio_not_found';
  end if;

  v_from := target_date::timestamp at time zone v_timezone;
  v_to := (target_date + 1)::timestamp at time zone v_timezone;
  v_reason := format('Cierre por %s', v_holiday.name);

  select
    count(*) filter (where cs.status = 'scheduled')::integer,
    count(distinct r.id) filter (where r.status = 'reserved')::integer,
    count(distinct cs.instructor_id) filter (
      where cs.status = 'scheduled' and cs.instructor_id is not null
    )::integer,
    count(distinct cs.space_id) filter (
      where cs.status = 'scheduled' and cs.space_id is not null
    )::integer
    into v_session_count, v_reservation_count, v_coach_count, v_space_count
  from public.class_sessions cs
  left join public.reservations r on r.session_id = cs.id
  where cs.studio_id = target_studio_id
    and cs.starts_at >= v_from
    and cs.starts_at < v_to;

  if p_operation_mode = 'special' then
    select coalesce(array_agg(distinct cs.recurring_schedule_id)
      filter (where cs.recurring_schedule_id is not null), '{}'::uuid[])
      into v_keep_schedule_ids
    from public.class_sessions cs
    where cs.studio_id = target_studio_id
      and cs.starts_at >= v_from
      and cs.starts_at < v_to
      and cs.id = any(v_keep_session_ids);
  end if;

  insert into public.studio_holiday_overrides (
    studio_id,
    official_holiday_id,
    holiday_date,
    operation_mode,
    student_message,
    special_recurring_schedule_ids,
    configured_by,
    configured_at,
    updated_at
  )
  values (
    target_studio_id,
    v_holiday.id,
    target_date,
    p_operation_mode,
    coalesce(nullif(trim(p_student_message), ''), v_holiday.default_message),
    v_keep_schedule_ids,
    (select auth.uid()),
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (studio_id, holiday_date)
  do update set
    official_holiday_id = excluded.official_holiday_id,
    operation_mode = excluded.operation_mode,
    student_message = excluded.student_message,
    special_recurring_schedule_ids = excluded.special_recurring_schedule_ids,
    configured_by = excluded.configured_by,
    configured_at = clock_timestamp(),
    updated_at = clock_timestamp()
  returning * into v_override;

  insert into public.studio_holiday_override_history (
    studio_id,
    official_holiday_id,
    holiday_date,
    operation_mode,
    student_message,
    special_recurring_schedule_ids,
    created_by
  )
  values (
    v_override.studio_id,
    v_override.official_holiday_id,
    v_override.holiday_date,
    v_override.operation_mode,
    v_override.student_message,
    v_override.special_recurring_schedule_ids,
    (select auth.uid())
  );

  -- First restore sessions previously cancelled by this same holiday override so a mode can be changed.
  update public.class_sessions
  set status = 'scheduled',
      holiday_override_id = null,
      cancellation_reason = null,
      is_schedule_exception = case
        when recurring_schedule_id is not null then false
        else is_schedule_exception
      end
  where studio_id = target_studio_id
    and holiday_override_id = v_override.id
    and starts_at >= v_from
    and starts_at < v_to
    and starts_at > clock_timestamp()
    and status = 'cancelled';

  if p_operation_mode = 'closed' then
    update public.class_sessions
    set status = 'cancelled',
        holiday_override_id = v_override.id,
        cancellation_reason = v_reason,
        is_schedule_exception = true
    where studio_id = target_studio_id
      and starts_at >= v_from
      and starts_at < v_to
      and starts_at > clock_timestamp()
      and status = 'scheduled';
  elsif p_operation_mode = 'special' then
    update public.class_sessions
    set holiday_override_id = v_override.id,
        cancellation_reason = null,
        is_schedule_exception = true
    where studio_id = target_studio_id
      and starts_at >= v_from
      and starts_at < v_to
      and starts_at > clock_timestamp()
      and status = 'scheduled'
      and id = any(v_keep_session_ids);

    update public.class_sessions
    set status = 'cancelled',
        holiday_override_id = v_override.id,
        cancellation_reason = v_reason,
        is_schedule_exception = true
    where studio_id = target_studio_id
      and starts_at >= v_from
      and starts_at < v_to
      and starts_at > clock_timestamp()
      and status = 'scheduled'
      and not (id = any(v_keep_session_ids));
  else
    update public.class_sessions
    set holiday_override_id = null,
        cancellation_reason = null,
        is_schedule_exception = case
          when recurring_schedule_id is not null then false
          else is_schedule_exception
        end
    where studio_id = target_studio_id
      and starts_at >= v_from
      and starts_at < v_to
      and starts_at > clock_timestamp()
      and status = 'scheduled'
      and holiday_override_id = v_override.id;
  end if;

  return jsonb_build_object(
    'holiday_id', v_holiday.id,
    'holiday_name', v_holiday.name,
    'holiday_date', target_date,
    'operation_mode', p_operation_mode,
    'sessions_considered', coalesce(v_session_count, 0),
    'reservations_considered', coalesce(v_reservation_count, 0),
    'coaches_considered', coalesce(v_coach_count, 0),
    'spaces_considered', coalesce(v_space_count, 0)
  );
end;
$$;

revoke all on function public.admin_configure_holiday(uuid,date,text,text,uuid[])
from public, anon, service_role;
grant execute on function public.admin_configure_holiday(uuid,date,text,text,uuid[])
to authenticated;

create or replace function public.student_holiday_snapshot(target_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.*
    into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select jsonb_build_object(
    'holiday_id', h.id,
    'holiday_code', h.holiday_code,
    'holiday_date', h.holiday_date,
    'name', h.name,
    'theme_key', h.theme_key,
    'is_official', h.is_official,
    'operation_mode', coalesce(o.operation_mode, 'normal'),
    'message', coalesce(nullif(trim(o.student_message), ''), h.default_message),
    'configured', o.id is not null,
    'source_label', h.source_label,
    'source_url', h.source_url,
    'legal_basis', h.legal_basis
  )
    into v_result
  from public.official_holidays h
  left join public.studio_holiday_overrides o
    on o.official_holiday_id = h.id
   and o.studio_id = v_student.studio_id
   and o.holiday_date = h.holiday_date
  where h.country_code = 'MX'
    and h.holiday_date = target_date
    and h.is_official
  order by h.created_at
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.student_holiday_snapshot(date)
from public, anon, service_role;
grant execute on function public.student_holiday_snapshot(date)
to authenticated;

create or replace function public.student_holiday_week_snapshot(
  target_start date,
  target_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_start is null
     or target_end is null
     or target_end < target_start
     or target_end - target_start > 31 then
    raise exception 'date_range_invalid';
  end if;

  select s.*
    into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'holiday_date', h.holiday_date,
        'name', h.name,
        'theme_key', h.theme_key,
        'operation_mode', coalesce(o.operation_mode, 'normal')
      )
      order by h.holiday_date
    ),
    '[]'::jsonb
  )
    into v_result
  from public.official_holidays h
  left join public.studio_holiday_overrides o
    on o.official_holiday_id = h.id
   and o.studio_id = v_student.studio_id
   and o.holiday_date = h.holiday_date
  where h.country_code = 'MX'
    and h.is_official
    and h.holiday_date between target_start and target_end;

  return v_result;
end;
$$;

revoke all on function public.student_holiday_week_snapshot(date,date)
from public, anon, service_role;
grant execute on function public.student_holiday_week_snapshot(date,date)
to authenticated;

create or replace function public.materialize_recurring_schedule(
  p_schedule_id uuid,
  p_through date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.recurring_schedules%rowtype;
  t public.class_templates%rowtype;
  tz text;
  d date;
  last_date date;
  starts_at_value timestamptz;
  inserted_count integer := 0;
  v_override_id uuid;
  v_operation_mode text;
  v_special_schedule_ids uuid[];
begin
  select * into s
  from public.recurring_schedules
  where id = p_schedule_id;

  if not found or not s.active then
    return 0;
  end if;

  if not private.has_capability(s.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into t
  from public.class_templates
  where id = s.template_id
    and studio_id = s.studio_id;

  if not found then
    raise exception 'template_not_found';
  end if;

  select timezone into tz
  from public.studios
  where id = s.studio_id;

  last_date := least(
    coalesce(p_through, current_date + 84),
    coalesce(s.ends_on, 'infinity'::date)
  );
  d := greatest(s.starts_on, current_date - 1);

  while d <= last_date loop
    if extract(dow from d)::smallint = s.weekday then
      v_override_id := null;
      v_operation_mode := null;
      v_special_schedule_ids := '{}'::uuid[];

      select o.id, o.operation_mode, o.special_recurring_schedule_ids
        into v_override_id, v_operation_mode, v_special_schedule_ids
      from public.studio_holiday_overrides o
      where o.studio_id = s.studio_id
        and o.holiday_date = d
      limit 1;

      if v_operation_mode = 'closed'
         or (
           v_operation_mode = 'special'
           and not (s.id = any(coalesce(v_special_schedule_ids, '{}'::uuid[])))
         ) then
        d := d + 1;
        continue;
      end if;

      starts_at_value :=
        (d + s.local_time) at time zone coalesce(tz, 'America/Mexico_City');

      if not exists (
        select 1
        from public.class_sessions cs
        where cs.recurring_schedule_id = s.id
          and cs.starts_at = starts_at_value
      ) then
        if not public.admin_session_has_conflict(
          s.studio_id,
          starts_at_value,
          starts_at_value + make_interval(mins => t.duration_minutes),
          s.instructor_id,
          s.space_id,
          null
        ) then
          insert into public.class_sessions (
            studio_id,
            template_id,
            instructor_id,
            space_id,
            starts_at,
            ends_at,
            capacity,
            notes,
            recurring_schedule_id,
            requires_resource,
            resource_uses_per_item,
            holiday_override_id,
            is_schedule_exception
          )
          values (
            s.studio_id,
            s.template_id,
            s.instructor_id,
            s.space_id,
            starts_at_value,
            starts_at_value + make_interval(mins => t.duration_minutes),
            s.capacity,
            s.notes,
            s.id,
            t.requires_resource,
            t.resource_uses_per_item,
            case when v_operation_mode = 'special' then v_override_id else null end,
            v_operation_mode = 'special'
          );

          inserted_count := inserted_count + 1;
        end if;
      end if;
    end if;

    d := d + 1;
  end loop;

  return inserted_count;
end;
$$;

grant execute on function public.materialize_recurring_schedule(uuid, date)
to authenticated;

create or replace function public.handle_session_cancelled_reservations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from new.status then
    perform private.cancel_session_reservations_internal(
      new.id,
      case
        when nullif(trim(new.cancellation_reason), '') is not null
          then new.cancellation_reason
        when new.minimum_review_status = 'cancelled'
          then 'Clase cancelada automáticamente: mínimo de reservas no alcanzado'
        else 'Clase cancelada por el estudio'
      end,
      (select auth.uid())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists class_session_cancel_reservations on public.class_sessions;
create trigger class_session_cancel_reservations
after update of status on public.class_sessions
for each row
execute function public.handle_session_cancelled_reservations();

create or replace function public.student_classes_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_upcoming jsonb;
  v_history jsonb;
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

  select coalesce(jsonb_agg(item order by starts_at), '[]'::jsonb)
  into v_upcoming
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'reservation_id', r.id,
        'session_id', cs.id,
        'status', r.status::text,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'activity', ct.name,
        'discipline', d.name,
        'space', sp.name,
        'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
        'credits_held', r.credits_held
      ) item
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    join public.class_templates ct on ct.id = cs.template_id
    join public.disciplines d on d.id = ct.discipline_id
    left join public.spaces sp on sp.id = cs.space_id
    left join public.instructors i on i.id = cs.instructor_id
    left join public.persons ip on ip.id = i.person_id
    where r.student_id = v_student.id
      and r.studio_id = v_student.studio_id
      and r.status in ('reserved', 'attended')
      and cs.status = 'scheduled'
      and cs.ends_at > now()
    order by cs.starts_at
  ) q;

  select coalesce(jsonb_agg(item order by starts_at desc), '[]'::jsonb)
  into v_history
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'reservation_id', r.id,
        'session_id', cs.id,
        'status', r.status::text,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'activity', ct.name,
        'discipline', d.name,
        'space', sp.name,
        'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
        'credits_held', r.credits_held,
        'cancelled_at', r.cancelled_at,
        'cancellation_reason', r.cancellation_reason,
        'credit_restored', exists (
          select 1
          from public.credit_ledger cl
          where cl.reservation_id = r.id
            and cl.movement_type = 'release'
        )
      ) item
    from public.reservations r
    join public.class_sessions cs on cs.id = r.session_id
    join public.class_templates ct on ct.id = cs.template_id
    join public.disciplines d on d.id = ct.discipline_id
    left join public.spaces sp on sp.id = cs.space_id
    left join public.instructors i on i.id = cs.instructor_id
    left join public.persons ip on ip.id = i.person_id
    where r.student_id = v_student.id
      and r.studio_id = v_student.studio_id
      and not (
        r.status in ('reserved', 'attended')
        and cs.status = 'scheduled'
        and cs.ends_at > now()
      )
    order by cs.starts_at desc
    limit 100
  ) q;

  return jsonb_build_object('upcoming', v_upcoming, 'history', v_history);
end;
$$;

revoke all on function public.student_classes_feed()
from public, anon;
grant execute on function public.student_classes_feed()
to authenticated;

comment on table public.official_holidays is
  'FESTIVOS-01 official Mexico holiday catalog, sourced from official Art. 74 LFT guidance.';
comment on table public.studio_holiday_overrides is
  'FESTIVOS-01 per-studio decision for an official holiday: normal, closed or special.';
comment on column public.class_sessions.cancellation_reason is
  'Studio-level reason propagated to reservations when the session is cancelled.';
comment on function public.admin_configure_holiday(uuid,date,text,text,uuid[]) is
  'FESTIVOS-01 applies the studio decision inside the existing calendar and reuses normal cancellation/refund flows.';
