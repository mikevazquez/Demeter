create or replace function public.student_schedule_feed(
  target_start date,
  target_end date,
  target_discipline_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_studio public.studios%rowtype;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_start is null or target_end is null or target_end < target_start or target_end - target_start > 31 then
    raise exception 'date_range_invalid';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select * into v_studio
  from public.studios
  where id = v_student.studio_id;

  v_timezone := coalesce(v_studio.timezone, 'America/Mexico_City');
  v_from := target_start::timestamp at time zone v_timezone;
  v_to := (target_end + 1)::timestamp at time zone v_timezone;

  select coalesce(jsonb_agg(item order by starts_at), '[]'::jsonb)
  into v_result
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'session_id', cs.id,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'capacity', cs.capacity,
        'spots_available', greatest(
          cs.capacity - (
            select count(*)
            from public.reservations r
            where r.session_id = cs.id
              and r.status in ('reserved', 'attended')
          ),
          0
        ),
        'activity', ct.name,
        'discipline_id', d.id,
        'discipline', d.name,
        'credit_cost', greatest(coalesce(ct.credit_cost, 1), 1),
        'space', sp.name,
        'location', sl.name,
        'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
        'description', cs.notes,
        'requires_resource', cs.requires_resource,
        'resource_uses_per_item', cs.resource_uses_per_item,
        'eligibility', public.booking_eligibility(cs.id, v_student.id),
        'is_reserved', exists(
          select 1
          from public.reservations rr
          where rr.session_id = cs.id
            and rr.student_id = v_student.id
            and rr.status in ('reserved', 'attended')
        )
      ) as item
    from public.class_sessions cs
    join public.class_templates ct on ct.id = cs.template_id
    join public.disciplines d on d.id = ct.discipline_id
    left join public.spaces sp on sp.id = cs.space_id
    left join public.studio_locations sl on sl.id = cs.location_id
    left join public.instructors i on i.id = cs.instructor_id
    left join public.persons ip on ip.id = i.person_id
    where cs.studio_id = v_student.studio_id
      and cs.status = 'scheduled'
      and cs.starts_at >= greatest(v_from, now())
      and cs.starts_at < v_to
      and (target_discipline_id is null or d.id = target_discipline_id)
    order by cs.starts_at
  ) q;

  return v_result;
end;
$$;

create or replace function public.student_book_session(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.student_book_session_with_resource(target_session_id, null);
end;
$$;

grant execute on function public.student_schedule_feed(date, date, uuid) to authenticated;
grant execute on function public.student_book_session(uuid) to authenticated;

comment on function public.student_book_session(uuid) is
  'Books only sessions that do not require a physical resource. Resource sessions must use student_book_session_with_resource.';
