-- Demi QR reservation confirmation support.
-- Service-role-only lookup of the existing per-reservation kiosk credential.

create or replace function public.service_get_reservation_checkin_token(
  target_studio_id uuid,
  target_reservation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_token_row public.reservation_checkin_tokens%rowtype;
  v_token text;
begin
  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_found');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  select *
    into v_token_row
  from public.reservation_checkin_tokens
  where reservation_id = v_reservation.id
    and studio_id = target_studio_id;

  if v_reservation.status <> 'reserved'
     or v_session.status <> 'scheduled'
     or v_session.ends_at <= clock_timestamp()
     or v_token_row.id is null
     or v_token_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_valid');
  end if;

  v_token := private.checkin_token_value(
    v_reservation.id,
    v_token_row.token_version
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation.id,
    'session_id', v_reservation.session_id,
    'token', v_token
  );
end;
$function$;

revoke all on function public.service_get_reservation_checkin_token(uuid,uuid)
from public, anon, authenticated;

grant execute on function public.service_get_reservation_checkin_token(uuid,uuid)
to service_role;
