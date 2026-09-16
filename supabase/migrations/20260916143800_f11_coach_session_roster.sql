-- F11 · Coach: roster mínimo de una sesión asignada al instructor autenticado.

create or replace function public.coach_session_roster(
  target_studio_id uuid,
  target_session_id uuid
)
returns table (
  reservation_id uuid,
  student_id uuid,
  student_name text,
  attendance_status public.reservation_status,
  package_name text,
  commercial_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_instructor_id uuid;
begin
  v_instructor_id := private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.class_sessions cs
    where cs.id = target_session_id
      and cs.studio_id = target_studio_id
      and cs.instructor_id = v_instructor_id
  ) then
    raise exception 'session_not_available';
  end if;

  return query
  select
    r.id,
    s.id,
    s.full_name,
    r.status,
    pt.name,
    r.acquisition_id is null
  from public.reservations r
  join public.students s
    on s.id = r.student_id
   and s.studio_id = r.studio_id
  left join public.product_acquisitions pa
    on pa.id = r.acquisition_id
   and pa.studio_id = r.studio_id
  left join public.product_templates pt
    on pt.id = pa.product_template_id
   and pt.studio_id = pa.studio_id
  where r.studio_id = target_studio_id
    and r.session_id = target_session_id
    and r.status in ('reserved', 'attended', 'no_show')
  order by lower(s.full_name), r.booked_at;
end;
$$;

revoke execute on function public.coach_session_roster(uuid, uuid) from public, anon;
grant execute on function public.coach_session_roster(uuid, uuid) to authenticated;
