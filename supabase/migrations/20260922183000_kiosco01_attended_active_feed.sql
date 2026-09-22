-- KIOSCO-01 · keep checked-in classes visible until the session ends.
-- An attended reservation remains an active/current class so the student can
-- reopen its QR and the kiosk can demonstrate idempotent re-scan behavior.

create or replace function public.student_classes_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
        'cancellation_reason', r.cancellation_reason
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
$function$;
