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
    );
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
      select coalesce(sum(quantity),0)::int into v_credit_net from public.credit_ledger where reservation_id=v_reservation.id and acquisition_id=v_reservation.acquisition_id;
      v_desired_net:=case when target_status='reserved' or private.reservation_credit_should_consume(v_reservation.studio_id,target_status) then -v_credit_cost else 0 end;
      if v_desired_net<>v_credit_net then
        insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,reservation_id,note,created_by)
        values(v_reservation.studio_id,v_reservation.acquisition_id,'adjustment',v_desired_net-v_credit_net,v_reservation.id,'Corrección de asistencia: '||trim(target_reason),(select auth.uid()));
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

alter table private.admin_attendance_batches add column marked_versions jsonb not null default '{}'::jsonb;
create policy admin_attendance_batches_no_direct_access on private.admin_attendance_batches for all to authenticated using(false) with check(false);
create policy admin_kiosk_settings_no_direct_access on private.admin_kiosk_settings for all to authenticated using(false) with check(false);
create policy admin_kiosk_pin_attempts_no_direct_access on private.admin_kiosk_pin_attempts for all to authenticated using(false) with check(false);
create or replace function public.bulk_mark_attended(target_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype; ids uuid[]:='{}'; r record; batch uuid;
begin
 select * into s from public.class_sessions where id=target_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if not private.has_capability(s.studio_id,'attendance.write') or not private.can_manage_attendance_session(s.studio_id,s.id) then raise exception 'forbidden'; end if;
 if s.status<>'scheduled' or clock_timestamp()<s.starts_at-interval '20 minutes' then raise exception 'attendance_not_open'; end if;
 for r in select id from public.reservations where session_id=s.id and status='reserved' and commercial_status is distinct from 'payment_pending' for update loop
   perform public.set_attendance_status(r.id,'attended'); ids:=array_append(ids,r.id);
 end loop;
 insert into private.admin_attendance_batches(studio_id,session_id,actor_id,reservation_ids) values(s.studio_id,s.id,(select auth.uid()),ids) returning id into batch;
 update private.admin_attendance_batches set marked_versions=(select coalesce(jsonb_object_agg(id::text,updated_at),'{}'::jsonb) from public.reservations where id=any(ids)) where id=batch;
 return jsonb_build_object('ok',true,'count',cardinality(ids),'batch_id',batch);
end;
$$;
create or replace function public.undo_bulk_mark_attended(target_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.admin_attendance_batches%rowtype; s public.class_sessions%rowtype; changed integer;
begin
 select * into b from private.admin_attendance_batches where id=target_batch_id;
 if not found or b.actor_id<>(select auth.uid()) or b.undone_at is not null or clock_timestamp()>b.created_at+interval '5 seconds' then raise exception 'undo_expired'; end if;
 select * into s from public.class_sessions where id=b.session_id for update;
 if s.status<>'scheduled' or not private.has_capability(s.studio_id,'attendance.write') or not private.can_manage_attendance_session(s.studio_id,s.id) then raise exception 'undo_unavailable'; end if;
 update public.reservations set status='reserved',updated_at=clock_timestamp() where id=any(b.reservation_ids) and status='attended' and updated_at=(b.marked_versions->>id::text)::timestamptz and not exists(select 1 from public.attendance_checkins c where c.reservation_id=reservations.id);
 get diagnostics changed=row_count;
 update private.admin_attendance_batches set undone_at=clock_timestamp() where id=b.id;
 return jsonb_build_object('ok',true,'count',changed);
end;
$$;

create or replace function public.admin_expiring_packages(target_studio_id uuid,target_date date)
returns integer language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_capability(target_studio_id,'students.read') or not private.has_capability(target_studio_id,'admin.portal') then raise exception 'forbidden'; end if;
 return (select count(distinct pa.student_id)::integer from public.product_acquisitions pa join public.students s on s.id=pa.student_id and s.studio_id=pa.studio_id
 where pa.studio_id=target_studio_id and pa.status='active' and pa.refunded_at is null and s.active and s.lifecycle_status='active' and (pa.starts_on is null or pa.starts_on<=target_date) and (pa.expires_on is null or pa.expires_on>=target_date)
 and ((pa.expires_on<=target_date+7) or (not pa.unlimited and public.acquisition_credit_balance(pa.id)<=1)));
end;
$$;
revoke all on function public.admin_expiring_packages(uuid,date) from public,anon;
grant execute on function public.admin_expiring_packages(uuid,date) to authenticated;

create or replace function public.admin_coach_roster_extras(target_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.class_sessions%rowtype;
begin
 select * into s from public.class_sessions where id=target_session_id;
 if not found or not private.is_current_instructor_session(s.studio_id,s.id) then raise exception 'forbidden'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'payment_pending',r.commercial_status='payment_pending','evaluation_id',e.id,'evaluation_status',e.status,'class_kind',r.class_kind,'amount_minor',r.class_amount_minor)),'[]'::jsonb)
 from public.reservations r left join public.evaluation_invitations e on e.reservation_id=r.id and e.studio_id=s.studio_id and e.status in ('scheduled','in_progress') where r.session_id=s.id and r.studio_id=s.studio_id);
end;
$$;
revoke all on function public.admin_coach_roster_extras(uuid) from public,anon;
grant execute on function public.admin_coach_roster_extras(uuid) to authenticated;
