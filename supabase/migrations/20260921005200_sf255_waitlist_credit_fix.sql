-- SF-255A waitlist promotion credit revalidation fix.
-- Automatic promotion runs without a student JWT, so it must not call
-- the user-scoped public acquisition_credit_balance() helper.

create or replace function private.waitlist_book_student(
  p_waitlist_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.class_waitlist_entries%rowtype;
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_credit_balance integer := 0;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  select * into v_entry
  from public.class_waitlist_entries
  where id=p_waitlist_entry_id
  for update;

  if not found or v_entry.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason_code', 'waitlist_not_active');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_entry.session_id
  for update;

  if not found or v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='session_not_bookable', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  select * into v_student
  from public.students
  where id=v_entry.student_id and studio_id=v_entry.studio_id;

  if not found then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='student_not_found', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'student_not_found');
  end if;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'session_full');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    update public.class_waitlist_entries
    set status='expired',
        resolved_at=now(),
        resolution_reason=coalesce(v_eligibility->>'reason_code','not_eligible'),
        updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','not_eligible')
    );
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer,1),1);

  perform 1
  from public.product_acquisitions
  where id=v_acquisition_id
  for update;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'session_full');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id=v_session.id
      and r.student_id=v_student.id
      and r.status in ('reserved','attended')
  ) then
    update public.class_waitlist_entries
    set status='expired', resolved_at=now(), resolution_reason='already_reserved', updated_at=now()
    where id=v_entry.id;
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  if not v_unlimited then
    select coalesce(sum(cl.quantity),0)::integer
      into v_credit_balance
    from public.credit_ledger cl
    where cl.acquisition_id=v_acquisition_id;

    if v_credit_balance < v_credit_cost then
      update public.class_waitlist_entries
      set status='expired', resolved_at=now(), resolution_reason='no_credits', updated_at=now()
      where id=v_entry.id;
      return jsonb_build_object('ok', false, 'reason_code', 'no_credits');
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
  )
  values (
    v_session.studio_id,
    v_session.id,
    v_student.id,
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
    )
    values (
      v_session.studio_id,
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados al obtener un lugar desde lista de espera', v_credit_cost),
      null
    );
  end if;

  update public.class_waitlist_entries
  set status='promoted',
      resolved_at=now(),
      promoted_reservation_id=v_reservation_id,
      resolution_reason='seat_reassigned',
      updated_at=now()
  where id=v_entry.id;

  perform public.emit_domain_event(
    v_session.studio_id,
    'booking.created',
    'reservation',
    v_reservation_id,
    'booking.created:' || v_reservation_id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', v_session.id,
      'student_id', v_student.id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', v_unlimited,
      'source', 'waitlist',
      'waitlist_entry_id', v_entry.id
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'waitlist_entry_id', v_entry.id
  );
end;
$$;

revoke all on function private.waitlist_book_student(uuid)
from public, anon, authenticated, service_role;
