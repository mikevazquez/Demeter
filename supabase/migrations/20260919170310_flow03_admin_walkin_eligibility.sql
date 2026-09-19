-- FLUJO 03 / SF-N03 · FLUJO 03 · elegibilidad de walk-in para Admin/Hoy durante clase abierta.
-- Reusa el core protegido creado por FLUJO 03 / SF-N03 sin relajar booking_eligibility normal.

create or replace function public.attendance_walkin_eligibility(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  return private.booking_eligibility_core(
    target_session_id,
    target_student_id,
    true
  );
end;
$$;

revoke all on function public.attendance_walkin_eligibility(uuid, uuid) from public, anon;
grant execute on function public.attendance_walkin_eligibility(uuid, uuid) to authenticated;
