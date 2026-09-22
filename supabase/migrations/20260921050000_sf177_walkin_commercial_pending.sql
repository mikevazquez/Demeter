-- SF-177 · Walk-in sin pago, adaptado a SF-254.
-- No reintroduce el subsistema retirado de Atención. Usa domain_events + estado comercial vigente.

create or replace function private.sf177_walkin_commercial_coverage(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_timezone text;
  v_class_date date;
  v_acquisition record;
  v_balance integer;
begin
  select *
    into v_reservation
  from public.reservations
  where id = p_reservation_id;

  if not found then
    return jsonb_build_object('covered', false, 'reason_code', 'reservation_not_found');
  end if;

  if v_reservation.status not in ('reserved', 'attended', 'no_show') then
    return jsonb_build_object('covered', false, 'reason_code', 'reservation_not_open');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = v_reservation.studio_id;

  if not found then
    return jsonb_build_object('covered', false, 'reason_code', 'session_not_found');
  end if;

  select ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
    into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select s.timezone
    into v_timezone
  from public.studios s
  where s.id = v_reservation.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  for v_acquisition in
    select pa.id, pa.unlimited, pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_reservation.studio_id
      and pa.student_id = v_reservation.student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (
          pa.starts_on <= v_class_date
          and (pa.expires_on is null or pa.expires_on >= v_class_date)
        )
      )
      and ptd.discipline_id = v_discipline_id
    order by pa.unlimited desc, coalesce(pa.expires_on, 'infinity'::date) asc, pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object(
        'covered', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', true,
        'available_credits', null,
        'credit_cost', v_credit_cost
      );
    end if;

    select coalesce(sum(cl.quantity), 0)::integer
      into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition.id;

    if v_balance >= v_credit_cost then
      return jsonb_build_object(
        'covered', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', false,
        'available_credits', v_balance,
        'credit_cost', v_credit_cost
      );
    end if;
  end loop;

  return jsonb_build_object(
    'covered', false,
    'reason_code', 'commercial_coverage_missing',
    'credit_cost', v_credit_cost
  );
end;
$$;

revoke all on function private.sf177_walkin_commercial_coverage(uuid)
  from public, anon, authenticated;

create or replace function private.sf177_resolve_walkin_commercial_pending_for_student(
  p_student_id uuid,
  p_resolution_source text,
  p_resolution_source_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending record;
  v_coverage jsonb;
  v_resolved integer := 0;
begin
  if p_student_id is null then
    return 0;
  end if;

  for v_pending in
    select e.event_id,
           e.studio_id,
           e.source_entity_id as reservation_id,
           e.payload
    from public.domain_events e
    where e.event_type = 'walkin.commercial_pending'
      and e.source_entity_type = 'reservation'
      and e.payload->>'student_id' = p_student_id::text
      and not exists (
        select 1
        from public.domain_events resolved
        where resolved.studio_id = e.studio_id
          and resolved.event_type = 'walkin.commercial_resolved'
          and resolved.source_entity_type = 'reservation'
          and resolved.source_entity_id = e.source_entity_id
      )
    order by e.recorded_at
  loop
    v_coverage := private.sf177_walkin_commercial_coverage(v_pending.reservation_id);

    if coalesce((v_coverage->>'covered')::boolean, false) then
      perform public.emit_domain_event(
        p_studio_id => v_pending.studio_id,
        p_event_type => 'walkin.commercial_resolved',
        p_source_entity_type => 'reservation',
        p_source_entity_id => v_pending.reservation_id,
        p_deduplication_key => 'walkin.commercial_resolved:' || v_pending.reservation_id::text,
        p_actor_user_id => (select auth.uid()),
        p_payload => jsonb_build_object(
          'student_id', p_student_id,
          'session_id', v_pending.payload->>'session_id',
          'pending_event_id', v_pending.event_id,
          'resolution_source', nullif(trim(coalesce(p_resolution_source, '')), ''),
          'resolution_source_id', p_resolution_source_id,
          'acquisition_id', v_coverage->>'acquisition_id',
          'unlimited', v_coverage->'unlimited',
          'available_credits', v_coverage->'available_credits',
          'credit_cost', v_coverage->'credit_cost'
        ),
        p_causation_event_id => v_pending.event_id
      );

      v_resolved := v_resolved + 1;
    end if;
  end loop;

  return v_resolved;
end;
$$;

revoke all on function private.sf177_resolve_walkin_commercial_pending_for_student(uuid,text,uuid)
  from public, anon, authenticated;

create or replace function private.sf177_resolve_walkin_from_acquisition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sf177_resolve_walkin_commercial_pending_for_student(
    new.student_id,
    'product_acquisition',
    new.id
  );
  return new;
exception
  when others then
    return new;
end;
$$;

revoke all on function private.sf177_resolve_walkin_from_acquisition()
  from public, anon, authenticated;

drop trigger if exists sf177_resolve_walkin_after_acquisition on public.product_acquisitions;
create constraint trigger sf177_resolve_walkin_after_acquisition
after insert or update on public.product_acquisitions
deferrable initially deferred
for each row
execute function private.sf177_resolve_walkin_from_acquisition();

create or replace function private.sf177_resolve_walkin_from_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  if new.quantity <= 0
     or new.movement_type not in ('grant', 'release', 'adjustment') then
    return new;
  end if;

  select pa.student_id
    into v_student_id
  from public.product_acquisitions pa
  where pa.id = new.acquisition_id;

  if v_student_id is not null then
    perform private.sf177_resolve_walkin_commercial_pending_for_student(
      v_student_id,
      'credit_ledger',
      new.id
    );
  end if;

  return new;
exception
  when others then
    return new;
end;
$$;

revoke all on function private.sf177_resolve_walkin_from_credit()
  from public, anon, authenticated;

drop trigger if exists sf177_resolve_walkin_after_credit on public.credit_ledger;
create constraint trigger sf177_resolve_walkin_after_credit
after insert on public.credit_ledger
deferrable initially deferred
for each row
execute function private.sf177_resolve_walkin_from_credit();

create or replace function public.add_existing_walkin_student(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
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

  perform public.emit_domain_event(
    p_studio_id => v_session.studio_id,
    p_event_type => 'walkin.commercial_pending',
    p_source_entity_type => 'reservation',
    p_source_entity_id => v_reservation_id,
    p_deduplication_key => 'walkin.commercial_pending:' || v_reservation_id::text,
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', target_student_id,
      'session_id', target_session_id,
      'reason_code', v_reason,
      'credit_cost', v_credit_cost,
      'walkin', true,
      'commercial_pending', true
    )
  );

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
set search_path to ''
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
  if p_phone !~ '^[+][1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

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

  perform public.emit_domain_event(
    p_studio_id => v_session.studio_id,
    p_event_type => 'walkin.commercial_pending',
    p_source_entity_type => 'reservation',
    p_source_entity_id => v_reservation_id,
    p_deduplication_key => 'walkin.commercial_pending:' || v_reservation_id::text,
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', v_student_id,
      'session_id', target_session_id,
      'reason_code', 'no_active_product',
      'credit_cost', v_credit_cost,
      'walkin', true,
      'commercial_pending', true
    )
  );

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
