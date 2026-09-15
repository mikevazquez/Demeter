-- F8 SF-076: allow an existing active student to join as a walk-in without inventing a sale or acquisition.
-- Commercial resolution remains pending for F9. The reservation intentionally has no acquisition_id.
create or replace function public.add_existing_walkin_student(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_reservation_id uuid;
  v_count integer;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;
  if not private.has_capability(v_session.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_operable';
  end if;

  if exists (
    select 1
    from public.reservations
    where session_id = target_session_id
      and student_id = target_student_id
      and status in ('reserved', 'attended', 'no_show')
  ) then
    raise exception 'already_in_roster';
  end if;

  select count(*) into v_count
  from public.reservations
  where session_id = target_session_id
    and status in ('reserved', 'attended');

  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  insert into public.reservations(
    studio_id,
    session_id,
    student_id,
    status,
    credits_held
  )
  values (
    v_session.studio_id,
    target_session_id,
    target_student_id,
    'reserved',
    1
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'reservation_id', v_reservation_id,
    'walkin', true,
    'commercial_pending', true
  );
end;
$$;

revoke all on function public.add_existing_walkin_student(uuid, uuid) from public, anon;
grant execute on function public.add_existing_walkin_student(uuid, uuid) to authenticated;
