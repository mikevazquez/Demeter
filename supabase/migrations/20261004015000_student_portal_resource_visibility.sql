create or replace function public.student_classes_feed()
returns jsonb
language plpgsql
stable security definer
set search_path=''
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
        'resource_name', (
          select res.name
          from public.reservation_resource_assignments rra
          join public.resources res on res.id = rra.resource_id
          where rra.reservation_id = r.id
            and rra.studio_id = v_student.studio_id
            and rra.released_at is null
          order by rra.assigned_at desc
          limit 1
        ),
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
      and cs.ends_at > now()
      and (
        (
          r.status in ('reserved', 'attended')
          and cs.status = 'scheduled'
        )
        or (
          r.status = 'cancelled_by_studio'
          and cs.status = 'cancelled'
        )
      )
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
        'resource_name', (
          select res.name
          from public.reservation_resource_assignments rra
          join public.resources res on res.id = rra.resource_id
          where rra.reservation_id = r.id
            and rra.studio_id = v_student.studio_id
            and rra.released_at is null
          order by rra.assigned_at desc
          limit 1
        ),
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
        cs.ends_at > now()
        and (
          (
            r.status in ('reserved', 'attended')
            and cs.status = 'scheduled'
          )
          or (
            r.status = 'cancelled_by_studio'
            and cs.status = 'cancelled'
          )
        )
      )
    order by cs.starts_at desc
    limit 100
  ) q;

  return jsonb_build_object('upcoming', v_upcoming, 'history', v_history);
end;
$$;

revoke all on function public.student_classes_feed() from public, anon;
grant execute on function public.student_classes_feed() to authenticated;
