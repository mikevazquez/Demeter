-- Demi WhatsApp service-mode reschedule bridge.
-- Cancels the source and books the target in one transaction. Any target failure
-- raises and rolls the whole function back, preserving the original reservation.

create or replace function public.service_reschedule_student_reservation(
  target_studio_id uuid,
  target_student_id uuid,
  target_reservation_id uuid,
  target_session_id uuid,
  target_reason text default 'Reagendado por Demi'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source public.reservations%rowtype;
  v_source_session public.class_sessions%rowtype;
  v_target_session public.class_sessions%rowtype;
  v_cancel jsonb;
  v_booking jsonb;
  v_new_reservation_id uuid;
begin
  if target_studio_id is null
     or target_student_id is null
     or target_reservation_id is null
     or target_session_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  select *
    into v_source
  from public.reservations
  where id = target_reservation_id
    and studio_id = target_studio_id
    and student_id = target_student_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_found');
  end if;

  if v_source.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_reschedulable');
  end if;

  select *
    into v_source_session
  from public.class_sessions
  where id = v_source.session_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'source_session_not_found');
  end if;

  select *
    into v_target_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'target_session_not_found');
  end if;

  if v_target_session.id = v_source_session.id then
    return jsonb_build_object('ok', false, 'reason_code', 'same_session');
  end if;

  if v_target_session.status <> 'scheduled'
     or v_target_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  v_cancel := public.service_cancel_reservation(
    target_studio_id,
    target_student_id,
    target_reservation_id,
    nullif(trim(target_reason), '')
  );

  if not coalesce((v_cancel->>'ok')::boolean, false) then
    raise exception 'reschedule_cancel_failed:%',
      coalesce(v_cancel->>'reason_code', 'cancel_failed');
  end if;

  v_booking := public.service_book_student(
    target_studio_id,
    target_session_id,
    target_student_id
  );

  if not coalesce((v_booking->>'eligible')::boolean, false) then
    raise exception 'reschedule_booking_failed:%',
      coalesce(v_booking->>'reason_code', 'booking_failed');
  end if;

  v_new_reservation_id := nullif(v_booking->>'reservation_id', '')::uuid;

  perform public.emit_domain_event(
    target_studio_id,
    'booking.rescheduled',
    'reservation',
    v_new_reservation_id,
    'booking.rescheduled:assistant-whatsapp:' ||
      target_reservation_id::text || ':' || v_new_reservation_id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'source_reservation_id', target_reservation_id,
      'source_session_id', v_source_session.id,
      'target_reservation_id', v_new_reservation_id,
      'target_session_id', target_session_id,
      'student_id', target_student_id,
      'cancellation_status', v_cancel->>'status',
      'source_credit_cost', v_cancel->>'credit_cost',
      'target_credit_cost', v_booking->>'credit_cost',
      'reason', nullif(trim(target_reason), ''),
      'source', 'assistant_whatsapp'
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'source_reservation_id', target_reservation_id,
    'source_status', v_cancel->>'status',
    'target_reservation_id', v_new_reservation_id,
    'target_session_id', target_session_id,
    'credit_cost', v_booking->>'credit_cost'
  );
end;
$function$;

revoke all on function public.service_reschedule_student_reservation(uuid,uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.service_reschedule_student_reservation(uuid,uuid,uuid,uuid,text)
to service_role;
