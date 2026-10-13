-- Preserve the idempotent reservation movement constraint. Each correction
-- has its own adjustment, linked to the immutable attendance audit record.
alter table public.credit_ledger add column if not exists attendance_correction_id uuid references public.attendance_corrections(id);
create index if not exists credit_ledger_attendance_correction_idx on public.credit_ledger(attendance_correction_id) where attendance_correction_id is not null;
CREATE OR REPLACE FUNCTION public.set_attendance_status(target_reservation_id uuid, target_status reservation_status, target_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_old_status public.reservation_status;
  v_correction_id uuid;
  v_credit_cost integer;
  v_credit_net integer;
  v_desired_net integer;
  v_unlimited boolean;
begin
  select cs.* into v_session from public.class_sessions cs
  join public.reservations r on r.session_id=cs.id where r.id=target_reservation_id for update of cs;
  if not found then raise exception 'reservation_not_found'; end if;
  select * into v_reservation from public.reservations
  where id=target_reservation_id and studio_id=v_session.studio_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;


  if v_session.status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  if target_status not in ('reserved', 'attended', 'no_show') then
    raise exception 'invalid_attendance_status';
  end if;

  if target_status = 'attended' and v_reservation.commercial_status = 'payment_pending' then
    raise exception 'class_payment_required';
  end if;
  v_old_status := v_reservation.status;

  if v_old_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
    raise exception 'cancelled_reservation';
  end if;

  if v_session.status = 'completed' then
    if not private.can_manage_attendance_session(v_reservation.studio_id, v_session.id) then
      raise exception 'forbidden';
    end if;

    if nullif(trim(target_reason), '') is null then
      raise exception 'correction_reason_required';
    end if;

    if v_old_status not in ('reserved', 'attended', 'no_show') then
      raise exception 'invalid_completed_attendance_state';
    end if;

    if v_old_status = target_status then
      return jsonb_build_object(
        'ok', true,
        'status', target_status::text,
        'changed', false
      );
    end if;

    insert into public.attendance_corrections(
      studio_id,
      reservation_id,
      from_status,
      to_status,
      reason,
      corrected_by
    )
    values (
      v_reservation.studio_id,
      v_reservation.id,
      v_old_status,
      target_status,
      trim(target_reason),
      (select auth.uid())
    ) returning id into v_correction_id;
  else
    -- En sesión programada, Owner/Admin o el instructor asignado pueden operar,
    -- desde 20 minutos antes y hasta el cierre de la lista.
    if not private.can_manage_attendance_session(
      v_reservation.studio_id,
      v_session.id
    ) then
      raise exception 'forbidden';
    end if;

    if clock_timestamp() < v_session.starts_at - interval '20 minutes' then
      raise exception 'session_not_started';
    end if;



    if v_old_status not in ('reserved', 'attended', 'no_show') then
      raise exception 'invalid_attendance_state';
    end if;
  end if;

  if v_session.status='completed' and v_old_status<>target_status and v_reservation.acquisition_id is not null then
    select unlimited into v_unlimited from public.product_acquisitions where id=v_reservation.acquisition_id and studio_id=v_reservation.studio_id for update;
    if not coalesce(v_unlimited,false) then
      v_credit_cost:=greatest(coalesce(v_reservation.credits_held,1),1);
      select coalesce(sum(quantity),0)::int into v_credit_net from public.credit_ledger where acquisition_id=v_reservation.acquisition_id and (reservation_id=v_reservation.id or attendance_correction_id in (select id from public.attendance_corrections where reservation_id=v_reservation.id));
      v_desired_net:=case when target_status='reserved' or private.reservation_credit_should_consume(v_reservation.studio_id,target_status) then -v_credit_cost else 0 end;
      if v_desired_net<>v_credit_net then
        insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,attendance_correction_id,note,created_by)
        values(v_reservation.studio_id,v_reservation.acquisition_id,'adjustment',v_desired_net-v_credit_net,v_correction_id,'Corrección de asistencia: '||trim(target_reason),(select auth.uid()));
      end if;
    end if;
  end if;

  update public.reservations
  set status = target_status,
      updated_at = clock_timestamp()
  where id = v_reservation.id;

  return jsonb_build_object(
    'ok', true,
    'status', target_status::text,
    'changed', v_old_status <> target_status
  );
end;
$function$
;
revoke all on function public.set_attendance_status(uuid,public.reservation_status,text) from public,anon;
grant execute on function public.set_attendance_status(uuid,public.reservation_status,text) to authenticated;
