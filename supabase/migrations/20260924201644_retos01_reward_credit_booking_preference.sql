CREATE OR REPLACE FUNCTION public.book_student_with_reward_credits(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_credit_cost integer;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select *
    into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    raise exception 'student_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write')
     and not (
       v_student.user_id = (select auth.uid())
       and private.has_capability(v_session.studio_id, 'student.booking.self')
     ) then
    raise exception 'forbidden';
  end if;

  v_eligibility := private.reward_credit_booking_eligibility_core(
    target_session_id,
    target_student_id
  );

  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return v_eligibility;
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);

  perform 1
  from public.product_acquisitions
  where id = v_acquisition_id
  for update;

  select count(*)
    into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id
    and r.status in ('reserved', 'attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = target_student_id
      and r.status in ('reserved', 'attended')
  ) then
    return jsonb_build_object('eligible', false, 'reason_code', 'already_reserved');
  end if;

  if public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'reward_credits_unavailable',
      'credit_cost', v_credit_cost,
      'credit_source', 'reward'
    );
  end if;

  insert into public.reservations (
    studio_id,
    session_id,
    student_id,
    student_user_id,
    acquisition_id,
    status,
    credits_held
  ) values (
    v_session.studio_id,
    target_session_id,
    target_student_id,
    v_student.user_id,
    v_acquisition_id,
    'reserved',
    v_credit_cost
  )
  returning id into v_reservation_id;

  insert into public.credit_ledger (
    studio_id,
    acquisition_id,
    movement_type,
    quantity,
    reservation_id,
    note,
    created_by
  ) values (
    v_session.studio_id,
    v_acquisition_id,
    'reserve',
    -v_credit_cost,
    v_reservation_id,
    format('%s crédito(s) premio utilizados al confirmar la clase', v_credit_cost),
    (select auth.uid())
  );

  perform public.emit_domain_event(
    v_session.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', target_session_id,
      'student_id', target_student_id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', false,
      'source', 'reward_credit_booking'
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'eligible', true,
    'reason_code', null,
    'reservation_id', v_reservation_id,
    'acquisition_id', v_acquisition_id,
    'unlimited', false,
    'credit_cost', v_credit_cost,
    'credit_source', 'reward'
  );
end;
$function$


CREATE OR REPLACE FUNCTION private.reward_credit_booking_eligibility_core(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_base jsonb;
  v_session public.class_sessions%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_timezone text;
  v_class_date date;
  v_acquisition record;
  v_balance integer;
begin
  v_base := private.booking_eligibility_core(target_session_id, target_student_id, false);

  if not coalesce((v_base->>'eligible')::boolean, false) then
    return v_base;
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
    into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select timezone
    into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  for v_acquisition in
    select
      pa.id,
      pa.expires_on,
      pa.created_at
    from public.product_acquisitions pa
    join public.product_templates pt
      on pt.id = pa.product_template_id
     and pt.studio_id = pa.studio_id
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and pt.reward_credit_wallet
      and pa.starts_on <= v_class_date
      and pa.expires_on >= v_class_date
      and ptd.discipline_id = v_discipline_id
    order by
      pa.expires_on asc,
      pa.created_at asc
  loop
    select coalesce(sum(cl.quantity), 0)::integer
      into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition.id;

    if v_balance >= v_credit_cost then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', false,
        'available_credits', v_balance,
        'credit_cost', v_credit_cost,
        'expires_on', v_acquisition.expires_on,
        'credit_source', 'reward'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', false,
    'reason_code', 'reward_credits_unavailable',
    'credit_cost', v_credit_cost,
    'credit_source', 'reward'
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.student_book_session_with_reward_credits(target_session_id uuid, target_resource_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_session_resource public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student_id is null then
    raise exception 'forbidden';
  end if;

  if v_session.requires_resource then
    if target_resource_id is null then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_required'
      );
    end if;

    select sr.*
      into v_session_resource
    from public.session_resources sr
    where sr.studio_id = v_session.studio_id
      and sr.session_id = v_session.id
      and sr.resource_id = target_resource_id
    for update;

    if not found or not v_session_resource.enabled then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    select *
      into v_resource
    from public.resources r
    where r.id = target_resource_id
      and r.studio_id = v_session.studio_id
      and r.space_id = v_session.space_id;

    if not found or not v_resource.active then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    v_capacity := coalesce(
      v_session_resource.capacity_override,
      v_session.resource_uses_per_item,
      1
    );

    select count(*)::integer
      into v_used
    from public.reservation_resource_assignments a
    where a.studio_id = v_session.studio_id
      and a.session_id = v_session.id
      and a.resource_id = target_resource_id
      and a.released_at is null;

    if v_used >= v_capacity then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_full',
        'resource_id', target_resource_id
      );
    end if;
  end if;

  v_booking := public.book_student_with_reward_credits(
    target_session_id,
    v_student_id
  );

  if not coalesce((v_booking->>'eligible')::boolean, false) then
    return v_booking;
  end if;

  v_reservation_id := nullif(v_booking->>'reservation_id', '')::uuid;
  if v_reservation_id is null then
    raise exception 'booking_missing_reservation';
  end if;

  if v_session.requires_resource then
    insert into public.reservation_resource_assignments (
      studio_id,
      session_id,
      reservation_id,
      resource_id,
      assigned_by
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_reservation_id,
      target_resource_id,
      (select auth.uid())
    );
  end if;

  return v_booking || jsonb_build_object(
    'resource_id',
    case when v_session.requires_resource then target_resource_id else null end
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.student_reward_credit_booking_eligibility(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student_id is null then
    raise exception 'forbidden';
  end if;

  return private.reward_credit_booking_eligibility_core(
    target_session_id,
    v_student_id
  );
end;
$function$


revoke all on function public.student_reward_credit_booking_eligibility(uuid)
from public, anon;
grant execute on function public.student_reward_credit_booking_eligibility(uuid)
to authenticated;

revoke all on function public.book_student_with_reward_credits(uuid, uuid)
from public, anon;
grant execute on function public.book_student_with_reward_credits(uuid, uuid)
to authenticated;

revoke all on function public.student_book_session_with_reward_credits(uuid, uuid)
from public, anon;
grant execute on function public.student_book_session_with_reward_credits(uuid, uuid)
to authenticated;
