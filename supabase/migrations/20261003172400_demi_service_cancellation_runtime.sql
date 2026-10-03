-- Demi WhatsApp service-mode cancellation bridge.
-- Same cancellation rules as the interactive flow, but scoped to a verified
-- studio + student identity and executable only by service_role.

create or replace function public.service_cancel_reservation(
  target_studio_id uuid,
  target_student_id uuid,
  target_reservation_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer;
  v_new_status public.reservation_status;
begin
  if target_studio_id is null
     or target_student_id is null
     or target_reservation_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
    and studio_id = target_studio_id
    and student_id = target_student_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_found');
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_cancellable'
    );
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
  v_new_status := private.reservation_cancellation_outcome(
    target_studio_id,
    v_session.starts_at
  );

  update public.reservations
  set status = v_new_status,
      cancelled_at = now(),
      cancellation_reason = nullif(trim(target_reason), ''),
      cancelled_by = null,
      updated_at = now()
  where id = v_reservation.id;

  if v_reservation.acquisition_id is not null then
    select *
      into v_acquisition
    from public.product_acquisitions
    where id = v_reservation.acquisition_id
      and studio_id = target_studio_id
    for update;

    if found and not v_acquisition.unlimited then
      insert into public.credit_ledger(
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values (
        target_studio_id,
        v_reservation.acquisition_id,
        'release',
        v_credit_cost,
        v_reservation.id,
        case
          when v_new_status = 'cancelled_on_time'
            then format('%s crédito(s) devueltos por cancelación a tiempo', v_credit_cost)
          else format('Cierre del hold de %s crédito(s) por cancelación tardía', v_credit_cost)
        end,
        null
      )
      on conflict (reservation_id, movement_type) do nothing;

      if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
        insert into public.credit_ledger(
          studio_id,
          acquisition_id,
          movement_type,
          quantity,
          reservation_id,
          note,
          created_by
        )
        values (
          target_studio_id,
          v_reservation.acquisition_id,
          'consume',
          -v_credit_cost,
          v_reservation.id,
          format('%s crédito(s) consumidos por cancelación tardía', v_credit_cost),
          null
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;
    end if;

    if private.reservation_credit_should_consume(target_studio_id, v_new_status) then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end if;

  perform public.emit_domain_event(
    target_studio_id,
    'booking.cancelled',
    'reservation',
    v_reservation.id,
    'booking.cancelled:assistant-whatsapp:' || v_reservation.id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'session_id', v_reservation.session_id,
      'student_id', target_student_id,
      'status', v_new_status::text,
      'reason', nullif(trim(target_reason), ''),
      'source', 'assistant_whatsapp'
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'status', v_new_status::text,
    'credit_cost', v_credit_cost
  );
end;
$function$;

revoke all on function public.service_cancel_reservation(uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.service_cancel_reservation(uuid,uuid,uuid,text)
to service_role;
