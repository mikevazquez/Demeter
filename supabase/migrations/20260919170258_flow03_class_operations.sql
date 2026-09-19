-- FLUJO 03 / SF-N03 · FLUJO 03 · Operación de una clase
-- Consolida elegibilidad de walk-ins, snapshot de créditos y trazabilidad de correcciones
-- sin depender de SF-166 ni modificar las reglas de primer uso aprobadas en FLUJO 01.

create or replace function private.booking_eligibility_core(
  target_session_id uuid,
  target_student_id uuid,
  p_allow_started_session boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_booked_count integer;
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
  v_has_required_enrollment boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_found');
  end if;

  if v_student.lifecycle_status <> 'active' or not v_student.active then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_operable');
  end if;

  if v_session.status <> 'scheduled'
     or (not p_allow_started_session and v_session.starts_at <= now()) then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_bookable');
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

  select count(*) into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id
    and r.status in ('reserved', 'attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  select ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
    into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select timezone into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  select * into v_policy
  from public.enrollment_policies
  where studio_id = v_session.studio_id;

  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists (
      select 1
      from public.student_enrollments se
      where se.studio_id = v_session.studio_id
        and se.student_id = target_student_id
        and se.status = 'active'
        and se.starts_on <= v_class_date
        and (se.expires_on is null or se.expires_on >= v_class_date)
    ) into v_has_required_enrollment;

    if not v_has_required_enrollment then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'enrollment_required',
        'credit_cost', v_credit_cost
      );
    end if;
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
  ) into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists (
      select 1
      from public.product_acquisitions pa
      where pa.studio_id = v_session.studio_id
        and pa.student_id = target_student_id
        and pa.status = 'active'
        and pa.access_blocked
    ) into v_has_blocked_acquisition;

    if v_has_blocked_acquisition then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'payment_pending',
        'credit_cost', v_credit_cost
      );
    end if;

    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'no_active_product',
      'credit_cost', v_credit_cost
    );
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and ptd.discipline_id = v_discipline_id
  ) into v_has_discipline_acquisition;

  if not v_has_discipline_acquisition then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_product',
      'credit_cost', v_credit_cost
    );
  end if;

  for v_acquisition in
    select pa.id, pa.unlimited, pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and ptd.discipline_id = v_discipline_id
    order by pa.unlimited desc, coalesce(pa.expires_on, 'infinity'::date) asc, pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', true,
        'available_credits', null,
        'credit_cost', v_credit_cost
      );
    end if;

    select coalesce(sum(cl.quantity), 0)::integer into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition.id;

    if v_balance >= v_credit_cost then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', false,
        'available_credits', v_balance,
        'credit_cost', v_credit_cost
      );
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', false,
    'reason_code', 'no_credits',
    'credit_cost', v_credit_cost
  );
end;
$$;

revoke all on function private.booking_eligibility_core(uuid, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.booking_eligibility(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_is_staff boolean;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_found');
  end if;

  v_is_staff := private.has_capability(v_session.studio_id, 'schedule.write');

  if not v_is_staff
     and not (
       v_student.user_id = (select auth.uid())
       and private.has_capability(v_session.studio_id, 'student.booking.self')
     ) then
    raise exception 'forbidden';
  end if;

  return private.booking_eligibility_core(
    target_session_id,
    target_student_id,
    false
  );
end;
$$;

revoke all on function public.booking_eligibility(uuid, uuid) from public, anon;
grant execute on function public.booking_eligibility(uuid, uuid) to authenticated;

create or replace function public.add_existing_walkin_student(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_reason text;
  v_acquisition_id uuid;
  v_unlimited boolean := false;
  v_credit_cost integer := 1;
  v_reservation_id uuid;
  v_count integer;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_operable';
  end if;

  if exists (
    select 1
    from public.reservations
    where session_id = target_session_id
      and student_id = target_student_id
      and status in ('reserved', 'attended', 'no_show')
  ) then
    raise exception 'already_in_roster';
  end if;

  select count(*) into v_count
  from public.reservations
  where session_id = target_session_id
    and status in ('reserved', 'attended');

  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  select greatest(coalesce(ct.credit_cost, 1), 1)
    into v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  v_eligibility := private.booking_eligibility_core(
    target_session_id,
    target_student_id,
    true
  );

  if coalesce((v_eligibility->>'eligible')::boolean, false) then
    v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
    v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
    v_credit_cost := greatest(
      coalesce((v_eligibility->>'credit_cost')::integer, v_credit_cost, 1),
      1
    );

    perform 1
    from public.product_acquisitions
    where id = v_acquisition_id
      and studio_id = v_session.studio_id
    for update;

    if not found then raise exception 'acquisition_not_found'; end if;

    select count(*) into v_count
    from public.reservations
    where session_id = target_session_id
      and status in ('reserved', 'attended');

    if v_count >= v_session.capacity then raise exception 'session_full'; end if;

    if exists (
      select 1
      from public.reservations
      where session_id = target_session_id
        and student_id = target_student_id
        and status in ('reserved', 'attended', 'no_show')
    ) then
      raise exception 'already_in_roster';
    end if;

    if not v_unlimited
       and public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
      raise exception 'no_credits';
    end if;

    insert into public.reservations(
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
      target_session_id,
      target_student_id,
      v_student.user_id,
      v_acquisition_id,
      'reserved',
      v_credit_cost
    )
    returning id into v_reservation_id;

    if not v_unlimited then
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
        v_session.studio_id,
        v_acquisition_id,
        'reserve',
        -v_credit_cost,
        v_reservation_id,
        format('%s crédito(s) reservados al agregar walk-in con cobertura vigente', v_credit_cost),
        (select auth.uid())
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'student_id', target_student_id,
      'reservation_id', v_reservation_id,
      'walkin', true,
      'commercial_pending', false,
      'acquisition_id', v_acquisition_id,
      'unlimited', v_unlimited,
      'credit_cost', v_credit_cost
    );
  end if;

  v_reason := coalesce(v_eligibility->>'reason_code', 'walkin_not_allowed');

  if v_reason not in ('no_active_product', 'outside_product', 'no_credits') then
    raise exception '%', v_reason;
  end if;

  v_credit_cost := greatest(
    coalesce((v_eligibility->>'credit_cost')::integer, v_credit_cost, 1),
    1
  );

  insert into public.reservations(
    studio_id,
    session_id,
    student_id,
    student_user_id,
    status,
    credits_held
  )
  values (
    v_session.studio_id,
    target_session_id,
    target_student_id,
    v_student.user_id,
    'reserved',
    v_credit_cost
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'reservation_id', v_reservation_id,
    'walkin', true,
    'commercial_pending', true,
    'reason_code', v_reason,
    'credit_cost', v_credit_cost
  );
end;
$$;

create or replace function public.create_walkin_student(
  target_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_reservation_id uuid;
  v_full_name text;
  v_count integer;
  v_credit_cost integer := 1;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_session.studio_id, 'students.write')
     and not private.is_current_instructor_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  if exists (
    select 1
    from public.person_contacts
    where studio_id = v_session.studio_id
      and kind = 'phone'
      and value = p_phone
  ) then
    raise exception 'phone_exists';
  end if;

  select count(*) into v_count
  from public.reservations
  where session_id = target_session_id
    and status in ('reserved', 'attended');

  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  select greatest(coalesce(ct.credit_cost, 1), 1)
    into v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  v_credit_cost := greatest(coalesce(v_credit_cost, 1), 1);

  insert into public.persons(studio_id, first_name, last_name)
  values (
    v_session.studio_id,
    trim(p_first_name),
    nullif(trim(coalesce(p_last_name, '')), '')
  )
  returning id into v_person_id;

  insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
  values (v_person_id, v_session.studio_id, 'phone', p_phone, true);

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
        then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students(
    studio_id,
    person_id,
    full_name,
    phone,
    active,
    lifecycle_status,
    profile_status
  )
  values (
    v_session.studio_id,
    v_person_id,
    v_full_name,
    p_phone,
    true,
    'active',
    'incomplete'
  )
  returning id into v_student_id;

  update public.students
  set profile_status = private.student_profile_status(v_student_id),
      updated_at = now()
  where id = v_student_id;

  insert into public.reservations(
    studio_id,
    session_id,
    student_id,
    status,
    credits_held
  )
  values (
    v_session.studio_id,
    target_session_id,
    v_student_id,
    'reserved',
    v_credit_cost
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'reservation_id', v_reservation_id,
    'walkin', true,
    'commercial_pending', true,
    'reason_code', 'no_active_product',
    'credit_cost', v_credit_cost
  );
end;
$$;

create or replace function public.attendance_correction_history(
  target_session_id uuid
)
returns table (
  correction_id uuid,
  reservation_id uuid,
  student_id uuid,
  student_name text,
  from_status public.reservation_status,
  to_status public.reservation_status,
  reason text,
  corrected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then raise exception 'session_not_found'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  return query
  select
    ac.id,
    ac.reservation_id,
    s.id,
    s.full_name,
    ac.from_status,
    ac.to_status,
    ac.reason,
    ac.created_at
  from public.attendance_corrections ac
  join public.reservations r
    on r.id = ac.reservation_id
   and r.studio_id = ac.studio_id
   and r.session_id = target_session_id
  join public.students s
    on s.id = r.student_id
   and s.studio_id = r.studio_id
  where ac.studio_id = v_session.studio_id
  order by ac.created_at desc, ac.id desc;
end;
$$;

revoke all on function public.add_existing_walkin_student(uuid, uuid) from public, anon;
revoke all on function public.create_walkin_student(uuid, text, text, text) from public, anon;
revoke all on function public.attendance_correction_history(uuid) from public, anon;

grant execute on function public.add_existing_walkin_student(uuid, uuid) to authenticated;
grant execute on function public.create_walkin_student(uuid, text, text, text) to authenticated;
grant execute on function public.attendance_correction_history(uuid) to authenticated;
