CREATE OR REPLACE FUNCTION public.student_reservation_checkin_token(target_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_uid uuid := (select auth.uid());
  v_requested_studio uuid := private.requested_studio_id();
  v_authorized boolean := false;
  v_token text;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  select * into v_reservation
  from public.reservations
  where id = target_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if v_requested_studio is not null and v_reservation.studio_id <> v_requested_studio then
    raise exception 'forbidden';
  end if;

  v_authorized :=
    v_reservation.student_user_id = v_uid
    or exists (
      select 1
      from public.students s
      where s.id = v_reservation.student_id
        and s.studio_id = v_reservation.studio_id
        and s.user_id = v_uid
    )
    or exists (
      select 1
      from public.reservations host
      left join public.students hs
        on hs.id = host.student_id
       and hs.studio_id = host.studio_id
      where host.id = v_reservation.host_reservation_id
        and host.studio_id = v_reservation.studio_id
        and (host.student_user_id = v_uid or hs.user_id = v_uid)
    )
    or private.has_capability(v_reservation.studio_id, 'attendance.write');

  if not v_authorized then
    raise exception 'forbidden';
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = v_reservation.studio_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  select * into v_token_row
  from public.reservation_checkin_tokens
  where reservation_id = v_reservation.id;

  if v_reservation.status not in ('reserved','attended')
     or v_session.status <> 'scheduled'
     or v_session.ends_at <= now()
     or v_token_row.id is null
     or v_token_row.revoked_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_valid'
    );
  end if;

  v_token := private.checkin_token_value(
    v_reservation.id,
    v_token_row.token_version
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation.id,
    'session_id', v_reservation.session_id,
    'token', v_token,
    'check_in_opens_at', v_session.starts_at - interval '20 minutes',
    'check_in_closes_at', v_session.starts_at + interval '30 minutes'
  );
end;
$function$;
