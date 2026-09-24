-- FESTIVOS-02 · configuration center, manual special days and artwork uploads.

alter table public.studio_holiday_overrides
  alter column official_holiday_id drop not null,
  add column if not exists source_kind text not null default 'official',
  add column if not exists custom_name text,
  add column if not exists theme_key text,
  add column if not exists hero_image_path text,
  add column if not exists message_image_path text;

alter table public.studio_holiday_overrides
  drop constraint if exists studio_holiday_overrides_source_kind_check,
  drop constraint if exists studio_holiday_overrides_source_payload_check,
  drop constraint if exists studio_holiday_overrides_custom_name_length_check,
  drop constraint if exists studio_holiday_overrides_artwork_path_length_check;

alter table public.studio_holiday_overrides
  add constraint studio_holiday_overrides_source_kind_check
    check (source_kind in ('official', 'manual')),
  add constraint studio_holiday_overrides_source_payload_check
    check (
      (source_kind = 'official' and official_holiday_id is not null)
      or
      (source_kind = 'manual' and official_holiday_id is null and length(trim(custom_name)) between 2 and 100)
    ),
  add constraint studio_holiday_overrides_custom_name_length_check
    check (custom_name is null or length(trim(custom_name)) between 2 and 100),
  add constraint studio_holiday_overrides_artwork_path_length_check
    check (
      (hero_image_path is null or length(hero_image_path) <= 500)
      and
      (message_image_path is null or length(message_image_path) <= 500)
    );

alter table public.studio_holiday_override_history
  alter column official_holiday_id drop not null,
  add column if not exists source_kind text not null default 'official',
  add column if not exists custom_name text,
  add column if not exists theme_key text,
  add column if not exists hero_image_path text,
  add column if not exists message_image_path text;

alter table public.studio_holiday_override_history
  drop constraint if exists studio_holiday_history_source_kind_check;

alter table public.studio_holiday_override_history
  add constraint studio_holiday_history_source_kind_check
    check (source_kind in ('official', 'manual'));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'holiday-artwork',
  'holiday-artwork',
  true,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists holiday_artwork_insert_owner on storage.objects;
create policy holiday_artwork_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'holiday-artwork'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

drop policy if exists holiday_artwork_update_owner on storage.objects;
create policy holiday_artwork_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'holiday-artwork'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
)
with check (
  bucket_id = 'holiday-artwork'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

drop policy if exists holiday_artwork_delete_owner on storage.objects;
create policy holiday_artwork_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'holiday-artwork'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

create or replace function public.admin_save_calendar_day(
  target_studio_id uuid,
  target_date date,
  p_source_kind text,
  p_name text,
  p_operation_mode text,
  p_student_message text default null,
  p_keep_session_ids uuid[] default '{}'::uuid[],
  p_theme_key text default null,
  p_hero_image_path text default null,
  p_message_image_path text default null
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
  v_name text;
  v_theme_key text;
  v_message text;
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
    raise exception 'calendar_day_target_required';
  end if;

  if p_source_kind not in ('official', 'manual') then
    raise exception 'calendar_day_source_invalid';
  end if;

  if p_operation_mode not in ('normal', 'closed', 'special') then
    raise exception 'calendar_day_operation_invalid';
  end if;

  if not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if p_source_kind = 'official' then
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

    v_name := v_holiday.name;
    v_theme_key := coalesce(nullif(trim(p_theme_key), ''), v_holiday.theme_key);
    v_message := coalesce(nullif(trim(p_student_message), ''), v_holiday.default_message);
  else
    v_name := nullif(trim(p_name), '');
    if v_name is null or length(v_name) < 2 or length(v_name) > 100 then
      raise exception 'manual_day_name_invalid';
    end if;
    v_theme_key := coalesce(nullif(trim(p_theme_key), ''), 'custom');
    v_message := coalesce(
      nullif(trim(p_student_message), ''),
      format('Hoy el estudio tendrá una operación especial por %s.', v_name)
    );
  end if;

  if p_hero_image_path is not null
     and (
       length(p_hero_image_path) > 500
       or split_part(p_hero_image_path, '/', 1) <> target_studio_id::text
     ) then
    raise exception 'hero_image_path_invalid';
  end if;

  if p_message_image_path is not null
     and (
       length(p_message_image_path) > 500
       or split_part(p_message_image_path, '/', 1) <> target_studio_id::text
     ) then
    raise exception 'message_image_path_invalid';
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
  v_reason := format('Cierre por %s', v_name);

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
    select coalesce(
      array_agg(distinct cs.recurring_schedule_id)
        filter (where cs.recurring_schedule_id is not null),
      '{}'::uuid[]
    )
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
    updated_at,
    source_kind,
    custom_name,
    theme_key,
    hero_image_path,
    message_image_path
  )
  values (
    target_studio_id,
    case when p_source_kind = 'official' then v_holiday.id else null end,
    target_date,
    p_operation_mode,
    v_message,
    v_keep_schedule_ids,
    (select auth.uid()),
    clock_timestamp(),
    clock_timestamp(),
    p_source_kind,
    case when p_source_kind = 'manual' then v_name else null end,
    v_theme_key,
    nullif(trim(coalesce(p_hero_image_path, '')), ''),
    nullif(trim(coalesce(p_message_image_path, '')), '')
  )
  on conflict (studio_id, holiday_date)
  do update set
    official_holiday_id = excluded.official_holiday_id,
    operation_mode = excluded.operation_mode,
    student_message = excluded.student_message,
    special_recurring_schedule_ids = excluded.special_recurring_schedule_ids,
    configured_by = excluded.configured_by,
    configured_at = clock_timestamp(),
    updated_at = clock_timestamp(),
    source_kind = excluded.source_kind,
    custom_name = excluded.custom_name,
    theme_key = excluded.theme_key,
    hero_image_path = excluded.hero_image_path,
    message_image_path = excluded.message_image_path
  returning * into v_override;

  insert into public.studio_holiday_override_history (
    studio_id,
    official_holiday_id,
    holiday_date,
    operation_mode,
    student_message,
    special_recurring_schedule_ids,
    created_by,
    source_kind,
    custom_name,
    theme_key,
    hero_image_path,
    message_image_path
  )
  values (
    v_override.studio_id,
    v_override.official_holiday_id,
    v_override.holiday_date,
    v_override.operation_mode,
    v_override.student_message,
    v_override.special_recurring_schedule_ids,
    (select auth.uid()),
    v_override.source_kind,
    v_override.custom_name,
    v_override.theme_key,
    v_override.hero_image_path,
    v_override.message_image_path
  );

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
  end if;

  return jsonb_build_object(
    'day_name', v_name,
    'holiday_date', target_date,
    'source_kind', p_source_kind,
    'operation_mode', p_operation_mode,
    'sessions_considered', coalesce(v_session_count, 0),
    'reservations_considered', coalesce(v_reservation_count, 0),
    'coaches_considered', coalesce(v_coach_count, 0),
    'spaces_considered', coalesce(v_space_count, 0)
  );
end;
$$;

revoke all on function public.admin_save_calendar_day(
  uuid,date,text,text,text,text,uuid[],text,text,text
) from public, anon, service_role;

grant execute on function public.admin_save_calendar_day(
  uuid,date,text,text,text,text,uuid[],text,text,text
) to authenticated;

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
  v_existing public.studio_holiday_overrides%rowtype;
begin
  select *
    into v_existing
  from public.studio_holiday_overrides
  where studio_id = target_studio_id
    and holiday_date = target_date
  limit 1;

  return public.admin_save_calendar_day(
    target_studio_id,
    target_date,
    'official',
    null,
    p_operation_mode,
    p_student_message,
    p_keep_session_ids,
    v_existing.theme_key,
    v_existing.hero_image_path,
    v_existing.message_image_path
  );
end;
$$;

revoke all on function public.admin_configure_holiday(uuid,date,text,text,uuid[])
from public, anon, service_role;
grant execute on function public.admin_configure_holiday(uuid,date,text,text,uuid[])
to authenticated;

create or replace function public.admin_delete_manual_calendar_day(
  target_studio_id uuid,
  target_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override public.studio_holiday_overrides%rowtype;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select *
    into v_override
  from public.studio_holiday_overrides
  where studio_id = target_studio_id
    and holiday_date = target_date
    and source_kind = 'manual'
  for update;

  if not found then
    raise exception 'manual_day_not_found';
  end if;

  select timezone into v_timezone
  from public.studios
  where id = target_studio_id;

  v_from := target_date::timestamp at time zone v_timezone;
  v_to := (target_date + 1)::timestamp at time zone v_timezone;

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

  update public.class_sessions
  set holiday_override_id = null
  where studio_id = target_studio_id
    and holiday_override_id = v_override.id;

  delete from public.studio_holiday_overrides
  where id = v_override.id;
end;
$$;

revoke all on function public.admin_delete_manual_calendar_day(uuid,date)
from public, anon, service_role;
grant execute on function public.admin_delete_manual_calendar_day(uuid,date)
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

  with candidate as (
    select
      h.id as holiday_id,
      h.holiday_code,
      h.holiday_date,
      h.name,
      coalesce(o.theme_key, h.theme_key) as theme_key,
      true as is_official,
      coalesce(o.operation_mode, 'normal') as operation_mode,
      coalesce(nullif(trim(o.student_message), ''), h.default_message) as message,
      o.id is not null as configured,
      h.source_label,
      h.source_url,
      h.legal_basis,
      o.hero_image_path,
      o.message_image_path,
      1 as priority
    from public.official_holidays h
    left join public.studio_holiday_overrides o
      on o.official_holiday_id = h.id
     and o.studio_id = v_student.studio_id
     and o.holiday_date = h.holiday_date
    where h.country_code = 'MX'
      and h.holiday_date = target_date
      and h.is_official

    union all

    select
      null::uuid as holiday_id,
      'manual'::text as holiday_code,
      o.holiday_date,
      o.custom_name as name,
      coalesce(o.theme_key, 'custom') as theme_key,
      false as is_official,
      o.operation_mode,
      o.student_message as message,
      true as configured,
      'Configuración del estudio'::text as source_label,
      null::text as source_url,
      null::text as legal_basis,
      o.hero_image_path,
      o.message_image_path,
      2 as priority
    from public.studio_holiday_overrides o
    where o.studio_id = v_student.studio_id
      and o.holiday_date = target_date
      and o.source_kind = 'manual'
  )
  select jsonb_build_object(
    'holiday_id', c.holiday_id,
    'holiday_code', c.holiday_code,
    'holiday_date', c.holiday_date,
    'name', c.name,
    'theme_key', c.theme_key,
    'is_official', c.is_official,
    'operation_mode', c.operation_mode,
    'message', c.message,
    'configured', c.configured,
    'source_label', c.source_label,
    'source_url', c.source_url,
    'legal_basis', c.legal_basis,
    'hero_image_path', c.hero_image_path,
    'message_image_path', c.message_image_path
  )
    into v_result
  from candidate c
  order by c.priority desc
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

  with official_rows as (
    select
      h.holiday_date,
      h.name,
      coalesce(o.theme_key, h.theme_key) as theme_key,
      coalesce(o.operation_mode, 'normal') as operation_mode,
      'official'::text as source_kind
    from public.official_holidays h
    left join public.studio_holiday_overrides o
      on o.official_holiday_id = h.id
     and o.studio_id = v_student.studio_id
     and o.holiday_date = h.holiday_date
    where h.country_code = 'MX'
      and h.is_official
      and h.holiday_date between target_start and target_end
  ),
  manual_rows as (
    select
      o.holiday_date,
      o.custom_name as name,
      coalesce(o.theme_key, 'custom') as theme_key,
      o.operation_mode,
      'manual'::text as source_kind
    from public.studio_holiday_overrides o
    where o.studio_id = v_student.studio_id
      and o.source_kind = 'manual'
      and o.holiday_date between target_start and target_end
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'holiday_date', rows.holiday_date,
        'name', rows.name,
        'theme_key', rows.theme_key,
        'operation_mode', rows.operation_mode,
        'source_kind', rows.source_kind
      )
      order by rows.holiday_date
    ),
    '[]'::jsonb
  )
    into v_result
  from (
    select * from official_rows
    union all
    select * from manual_rows
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.student_holiday_week_snapshot(date,date)
from public, anon, service_role;
grant execute on function public.student_holiday_week_snapshot(date,date)
to authenticated;

comment on column public.studio_holiday_overrides.source_kind is
  'FESTIVOS-02 distinguishes imported official holidays from manually added studio special days.';
comment on column public.studio_holiday_overrides.hero_image_path is
  'Optional holiday hero artwork stored in the public holiday-artwork bucket.';
comment on column public.studio_holiday_overrides.message_image_path is
  'Optional artwork for the thematic message card stored in holiday-artwork.';
