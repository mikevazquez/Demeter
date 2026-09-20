-- Corrective ordering for post-finalization attendance corrections.
-- Emit after reservations.status changes, because attendance_corrections is inserted before
-- the reservation row is updated by the canonical attendance RPC.

drop trigger if exists reward_emit_attendance_corrected on public.attendance_corrections;

create or replace function private.reward_emit_attendance_corrected_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_status public.session_status;
  v_correction_id uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select cs.status into v_session_status
  from public.class_sessions cs
  where cs.id = new.session_id
    and cs.studio_id = new.studio_id;

  if v_session_status <> 'completed' or new.student_id is null then
    return new;
  end if;

  select ac.id into v_correction_id
  from public.attendance_corrections ac
  where ac.studio_id = new.studio_id
    and ac.reservation_id = new.id
    and ac.from_status = old.status
    and ac.to_status = new.status
  order by ac.created_at desc, ac.id desc
  limit 1;

  if v_correction_id is null then
    return new;
  end if;

  perform public.emit_domain_event(
    new.studio_id,
    'attendance.corrected',
    'reservation',
    new.id,
    'rewards:attendance:corrected:' || v_correction_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', new.student_id,
      'reservation_id', new.id,
      'session_id', new.session_id,
      'from_status', old.status,
      'to_status', new.status,
      'correction_id', v_correction_id
    ),
    null,
    null,
    null
  );

  return new;
end;
$$;

revoke all on function private.reward_emit_attendance_corrected_from_reservation()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_attendance_corrected_from_reservation on public.reservations;
create trigger reward_emit_attendance_corrected_from_reservation
after update of status on public.reservations
for each row execute function private.reward_emit_attendance_corrected_from_reservation();
