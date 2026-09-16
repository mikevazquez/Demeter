-- F11 · Coach: alcance por instructor autenticado y feed seguro de Mis clases.

create or replace function private.current_instructor_id(target_studio_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
  from public.studio_memberships sm
  join public.instructors i
    on i.studio_id = sm.studio_id
   and i.person_id = sm.person_id
   and i.status = 'active'
  join public.role_capabilities rc
    on rc.role = sm.role
   and rc.capability_key = 'instructor.portal'
  where sm.studio_id = target_studio_id
    and sm.user_id = (select auth.uid())
    and sm.active = true
    and sm.person_id is not null
  limit 1;
$$;

create or replace function private.is_current_instructor_assignment(
  target_studio_id uuid,
  target_instructor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_instructor_id is not null
    and target_instructor_id = private.current_instructor_id(target_studio_id);
$$;

create or replace function private.is_current_instructor_session(
  target_studio_id uuid,
  target_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.id = target_session_id
      and cs.studio_id = target_studio_id
      and private.is_current_instructor_assignment(cs.studio_id, cs.instructor_id)
  );
$$;

revoke execute on function private.current_instructor_id(uuid) from public, anon;
revoke execute on function private.is_current_instructor_assignment(uuid, uuid) from public, anon;
revoke execute on function private.is_current_instructor_session(uuid, uuid) from public, anon;
grant execute on function private.current_instructor_id(uuid) to authenticated;
grant execute on function private.is_current_instructor_assignment(uuid, uuid) to authenticated;
grant execute on function private.is_current_instructor_session(uuid, uuid) to authenticated;

-- Mantiene lectura completa para administración/recepción y el catálogo de reservas de alumna,
-- pero un instructor sólo puede leer sesiones que estén asignadas a su Instructor operativo.
drop policy if exists sessions_member_select on public.class_sessions;
create policy sessions_member_select on public.class_sessions
for select to authenticated
using (
  private.has_studio_role(
    studio_id,
    array['owner'::public.studio_role, 'admin'::public.studio_role, 'reception'::public.studio_role, 'student'::public.studio_role]
  )
  or private.is_current_instructor_assignment(studio_id, instructor_id)
);

-- La alumna conserva sólo su propia reserva; owner/admin conservan operación completa;
-- Coach sólo ve reservas de sesiones realmente asignadas a su Instructor.
drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations
for select to authenticated
using (
  student_user_id = (select auth.uid())
  or private.has_studio_role(
    studio_id,
    array['owner'::public.studio_role, 'admin'::public.studio_role]
  )
  or private.is_current_instructor_session(studio_id, session_id)
);

create or replace function public.coach_my_sessions(
  target_studio_id uuid,
  target_from timestamptz,
  target_to timestamptz
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
begin
  if target_from is null or target_to is null or target_to <= target_from then
    raise exception 'invalid_range';
  end if;

  if target_to - target_from > interval '93 days' then
    raise exception 'range_too_large';
  end if;

  v_instructor_id := private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

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
    and cs.starts_at >= target_from
    and cs.starts_at < target_to
  group by cs.id, cs.starts_at, cs.ends_at, cs.status, cs.capacity, ct.name, sp.name
  order by cs.starts_at, ct.name;
end;
$$;

revoke execute on function public.coach_my_sessions(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.coach_my_sessions(uuid, timestamptz, timestamptz) to authenticated;
