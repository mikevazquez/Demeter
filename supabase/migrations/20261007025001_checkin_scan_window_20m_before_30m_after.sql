-- QR check-in window: 20 minutes before class through 30 minutes after start.
-- Use one wall-clock instant after acquiring locks for the scan decision.

CREATE OR REPLACE FUNCTION public.check_in_reservation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_hash bytea;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_session_id uuid;
  v_activity text;
  v_student_name text;
  v_existing_checkin public.attendance_checkins%rowtype;
  v_checked_in_at timestamptz;
  v_requested_studio uuid := private.requested_studio_id();
begin
  if nullif(trim(coalesce(p_token, '')), '') is null
     or length(trim(p_token)) > 200 then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  v_token_hash := extensions.digest(
    convert_to(trim(p_token), 'UTF8'),
    'sha256'
  );

  select * into v_token_row
  from public.reservation_checkin_tokens
  where token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  -- Lee la referencia primero y después bloquea en el mismo orden que el cierre:
  -- sesión -> reserva. Esto evita carreras entre el último scan y finalize_attendance.
  select r.session_id into v_session_id
  from public.reservations r
  where r.id = v_token_row.reservation_id;

  if v_session_id is null then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  select * into v_reservation
  from public.reservations
  where id = v_token_row.reservation_id
    and session_id = v_session.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'invalid_token');
  end if;

  if v_requested_studio is not null and v_reservation.studio_id <> v_requested_studio then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  select ct.name into v_activity
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = v_session.studio_id;

  select coalesce(
    (
      select s.full_name
      from public.students s
      where s.id = v_reservation.student_id
        and s.studio_id = v_reservation.studio_id
    ),
    (
      select trim(concat_ws(' ', p.first_name, p.last_name))
      from public.persons p
      where p.id = v_reservation.guest_person_id
        and p.studio_id = v_reservation.studio_id
    ),
    'Asistente'
  ) into v_student_name;

  if v_session.status = 'cancelled'
     or v_token_row.revoked_at is not null
     or v_reservation.status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  v_checked_in_at := clock_timestamp();

  if v_checked_in_at < v_session.starts_at - interval '20 minutes' then
    return jsonb_build_object(
      'ok', false,
      'status', 'too_early',
      'available_at', v_session.starts_at - interval '20 minutes'
    );
  end if;

  if v_checked_in_at >= v_session.starts_at + interval '30 minutes'
     or v_session.status = 'completed'
     or v_reservation.status = 'no_show' then
    return jsonb_build_object(
      'ok', false,
      'status', 'session_finished'
    );
  end if;

  if v_reservation.status = 'attended' then
    select * into v_existing_checkin
    from public.attendance_checkins
    where reservation_id = v_reservation.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'already_attended',
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_name', v_student_name,
      'activity', v_activity,
      'starts_at', v_session.starts_at,
      'ends_at', v_session.ends_at,
      'checked_in_at', v_existing_checkin.checked_in_at
    );
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'status', 'reservation_invalid'
    );
  end if;

  update public.reservations
  set status = 'attended',
      updated_at = v_checked_in_at
  where id = v_reservation.id;

  insert into public.attendance_checkins(
    studio_id,
    reservation_id,
    session_id,
    source,
    actor_user_id,
    checked_in_at
  )
  values (
    v_reservation.studio_id,
    v_reservation.id,
    v_session.id,
    'KIOSK',
    (select auth.uid()),
    v_checked_in_at
  )
  on conflict (reservation_id) do nothing;

  perform public.emit_domain_event(
    v_reservation.studio_id,
    'attendance.checked_in',
    'reservation',
    v_reservation.id,
    'attendance:checked_in:' || v_reservation.id::text,
    v_checked_in_at,
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'session_id', v_session.id,
      'student_id', v_reservation.student_id,
      'guest_person_id', v_reservation.guest_person_id,
      'source', 'KIOSK',
      'checked_in_at', v_checked_in_at
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'success',
    'reservation_id', v_reservation.id,
    'session_id', v_session.id,
    'student_name', v_student_name,
    'activity', v_activity,
    'starts_at', v_session.starts_at,
    'ends_at', v_session.ends_at,
    'checked_in_at', v_checked_in_at
  );
end;
$function$;
