-- F11 · Coach: detalle seguro de una sesión asignada al instructor autenticado.

create or replace function public.coach_session_detail(
  target_studio_id uuid,
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_instructor_id uuid;
  v_result jsonb;
begin
  v_instructor_id := private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'session_id', cs.id,
    'starts_at', cs.starts_at,
    'ends_at', cs.ends_at,
    'status', cs.status::text,
    'capacity', cs.capacity,
    'activity', ct.name,
    'space', sp.name,
    'notes', cs.notes,
    'reserved_count', (
      select count(*)
      from public.reservations r
      where r.studio_id = cs.studio_id
        and r.session_id = cs.id
        and r.status in ('reserved', 'attended', 'no_show')
    )
  )
  into v_result
  from public.class_sessions cs
  join public.class_templates ct
    on ct.id = cs.template_id
   and ct.studio_id = cs.studio_id
  left join public.spaces sp
    on sp.id = cs.space_id
   and sp.studio_id = cs.studio_id
  where cs.studio_id = target_studio_id
    and cs.id = target_session_id
    and cs.instructor_id = v_instructor_id;

  if v_result is null then
    raise exception 'session_not_available';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.coach_session_detail(uuid, uuid) from public, anon;
grant execute on function public.coach_session_detail(uuid, uuid) to authenticated;
