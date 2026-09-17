-- F11 · SF-113 Coach walk-in: búsqueda exacta por teléfono, sin listado global de alumnas.
-- FL-11 permite buscar existente o alta mínima; este RPC limita la búsqueda a un teléfono E.164 exacto
-- y sólo dentro de una sesión que el usuario autenticado puede gestionar.

create or replace function public.coach_find_walkin_student(
  target_studio_id uuid,
  target_session_id uuid,
  target_phone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_student_name text;
  v_already_in_roster boolean;
begin
  if target_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone_invalid';
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id;

  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(target_studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(target_studio_id, target_session_id) then
    raise exception 'forbidden';
  end if;

  select s.id, s.full_name
  into v_student_id, v_student_name
  from public.students s
  join public.person_contacts pc
    on pc.person_id = s.person_id
   and pc.studio_id = s.studio_id
  where s.studio_id = target_studio_id
    and s.active = true
    and s.lifecycle_status = 'active'
    and pc.kind = 'phone'
    and pc.value = target_phone
  order by pc.is_primary desc, pc.created_at asc
  limit 1;

  if v_student_id is null then
    return jsonb_build_object('found', false);
  end if;

  select exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = v_student_id
      and r.status in ('reserved', 'attended', 'no_show')
  ) into v_already_in_roster;

  return jsonb_build_object(
    'found', true,
    'student_id', v_student_id,
    'student_name', v_student_name,
    'already_in_roster', v_already_in_roster
  );
end;
$$;

revoke all on function public.coach_find_walkin_student(uuid, uuid, text) from public, anon;
grant execute on function public.coach_find_walkin_student(uuid, uuid, text) to authenticated;
