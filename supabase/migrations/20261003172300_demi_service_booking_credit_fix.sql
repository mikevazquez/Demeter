-- Fix Demi service booking credit revalidation.
-- The service path must recompute the locked acquisition balance directly,
-- because acquisition_credit_balance applies interactive-user capability checks.

create or replace function public.service_book_student(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_balance integer := 0;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  if target_studio_id is null or target_session_id is null or target_student_id is null then
    return jsonb_build_object('eligible', false, 'reason_code', 'invalid_input');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id
  for update;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select *
    into v_student
  from public.students
  where id = target_student_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_found');
  end if;

  v_eligibility := private.booking_eligibility_core(
    target_session_id,
    target_student_id,
    false
  );

  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return v_eligibility;
  end if;

  v_acquisition_id := nullif(v_eligibility->>'acquisition_id', '')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);

  if v_acquisition_id is not null then
    perform 1
    from public.product_acquisitions
    where id = v_acquisition_id
      and studio_id = target_studio_id
    for update;
  end if;

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

  if not v_unlimited then
    select coalesce(sum(cl.quantity), 0)::integer
      into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition_id;

    if v_balance < v_credit_cost then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'no_credits',
        'credit_cost', v_credit_cost
      );
    end if;
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
    target_studio_id,
    target_session_id,
    target_student_id,
    v_student.user_id,
    v_acquisition_id,
    'reserved',
    v_credit_cost
  )
  returning id into v_reservation_id;

  if not v_unlimited then
    insert into public.credit_ledger (
      studio_id,
      acquisition_id,
      movement_type,
      quantity,
      reservation_id,
      note,
      created_by
    ) values (
      target_studio_id,
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados al confirmar la clase', v_credit_cost),
      null
    );
  end if;

  perform public.emit_domain_event(
    target_studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', target_session_id,
      'student_id', target_student_id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', v_unlimited,
      'source', 'assistant_whatsapp'
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
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost
  );
end;
$function$;

revoke all on function public.service_book_student(uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.service_book_student(uuid,uuid,uuid)
to service_role;
