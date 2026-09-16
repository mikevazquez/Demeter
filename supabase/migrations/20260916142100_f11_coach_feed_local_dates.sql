-- F11 · Coach: el rango del feed se expresa en fechas locales del estudio.

drop function if exists public.coach_my_sessions(uuid, timestamptz, timestamptz);

create or replace function public.coach_my_sessions(
  target_studio_id uuid,
  target_start date,
  target_end date
)
returns table (
  session_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  session_status public.session_status,
  capacity integer,
  template_name text,
  space_name text,
  reserved_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_instructor_id uuid;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if target_start is null or target_end is null or target_end < target_start then
    raise exception 'invalid_range';
  end if;

  if target_end - target_start > 92 then
    raise exception 'range_too_large';
  end if;

  v_instructor_id := private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = target_studio_id and s.status = 'active';

  if v_timezone is null then
    raise exception 'studio_not_available';
  end if;

  v_from := target_start::timestamp at time zone v_timezone;
  v_to := (target_end + 1)::timestamp at time zone v_timezone;

  return query
  select
    cs.id,
    cs.starts_at,
    cs.ends_at,
    cs.status,
    cs.capacity,
    ct.name,
    sp.name,
    count(r.id) filter (
      where r.status in (
        'reserved'::public.reservation_status,
        'attended'::public.reservation_status,
        'no_show'::public.reservation_status
      )
    ) as reserved_count
  from public.class_sessions cs
  join public.class_templates ct
    on ct.id = cs.template_id
   and ct.studio_id = cs.studio_id
  left join public.spaces sp
    on sp.id = cs.space_id
   and sp.studio_id = cs.studio_id
  left join public.reservations r
    on r.session_id = cs.id
   and r.studio_id = cs.studio_id
  where cs.studio_id = target_studio_id
    and cs.instructor_id = v_instructor_id
    and cs.starts_at >= v_from
    and cs.starts_at < v_to
  group by cs.id, cs.starts_at, cs.ends_at, cs.status, cs.capacity, ct.name, sp.name
  order by cs.starts_at, ct.name;
end;
$$;

revoke execute on function public.coach_my_sessions(uuid, date, date) from public, anon;
grant execute on function public.coach_my_sessions(uuid, date, date) to authenticated;
