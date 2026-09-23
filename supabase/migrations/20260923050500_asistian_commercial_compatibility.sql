-- ASISTIAN-INBOUND-02
-- Production compatibility helpers required by the inbound booking lifecycle.
-- These functions already exist in Sandbox from the commercial pending UAT path;
-- keeping them in source control makes the production migration self-contained.

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
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select *
    into v_student
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

  select count(*)
    into v_booked_count
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

  select timezone
    into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  select *
    into v_policy
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
    )
      into v_has_required_enrollment;

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
  )
    into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists (
      select 1
      from public.product_acquisitions pa
      where pa.studio_id = v_session.studio_id
        and pa.student_id = target_student_id
        and pa.status = 'active'
        and pa.access_blocked
    )
      into v_has_blocked_acquisition;

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
  )
    into v_has_discipline_acquisition;

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
    order by
      pa.unlimited desc,
      coalesce(pa.expires_on, 'infinity'::date) asc,
      pa.created_at asc
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
    order by
      pa.unlimited desc,
      coalesce(pa.expires_on, 'infinity'::date) asc,
      pa.created_at asc
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
  v_reservation public.reservations%rowtype;
  v_coverage jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_balance integer;
  v_resolved integer := 0;
begin
  if p_student_id is null then
    return 0;
  end if;

  for v_pending in
    select
      e.event_id,
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
    select *
      into v_reservation
    from public.reservations
    where id = v_pending.reservation_id
    for update;

    if not found
       or v_reservation.status not in ('reserved', 'attended', 'no_show') then
      continue;
    end if;

    v_coverage := private.sf177_walkin_commercial_coverage(v_pending.reservation_id);

    if not coalesce((v_coverage->>'covered')::boolean, false) then
      continue;
    end if;

    v_acquisition_id := (v_coverage->>'acquisition_id')::uuid;
    v_unlimited := coalesce((v_coverage->>'unlimited')::boolean, false);
    v_credit_cost := greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1);

    perform 1
    from public.product_acquisitions pa
    where pa.id = v_acquisition_id
      and pa.studio_id = v_pending.studio_id
      and pa.student_id = p_student_id
      and pa.status = 'active'
      and not pa.access_blocked
    for update;

    if not found then
      continue;
    end if;

    if v_reservation.acquisition_id is not null
       and v_reservation.acquisition_id <> v_acquisition_id then
      continue;
    end if;

    if not v_unlimited then
      select coalesce(sum(cl.quantity), 0)::integer
        into v_balance
      from public.credit_ledger cl
      where cl.acquisition_id = v_acquisition_id;

      if v_balance < v_credit_cost then
        continue;
      end if;
    end if;

    update public.reservations
    set acquisition_id = v_acquisition_id,
        credits_held = v_credit_cost,
        updated_at = now()
    where id = v_pending.reservation_id;

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
      values(
        v_pending.studio_id,
        v_acquisition_id,
        'reserve',
        -v_credit_cost,
        v_pending.reservation_id,
        format('%s crédito(s) reservados al regularizar walk-in', v_credit_cost),
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;

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
        'acquisition_id', v_acquisition_id,
        'unlimited', v_unlimited,
        'available_credits',
          case when v_unlimited then null else v_balance - v_credit_cost end,
        'credit_cost', v_credit_cost
      ),
      p_causation_event_id => v_pending.event_id
    );

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

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

drop trigger if exists sf177_resolve_walkin_after_credit
  on public.credit_ledger;

create constraint trigger sf177_resolve_walkin_after_credit
after insert
on public.credit_ledger
deferrable initially deferred
for each row
execute function private.sf177_resolve_walkin_from_credit();

revoke all on function private.booking_eligibility_core(uuid,uuid,boolean)
from public, anon, authenticated;

revoke all on function private.sf177_walkin_commercial_coverage(uuid)
from public, anon, authenticated;

revoke all on function private.sf177_resolve_walkin_commercial_pending_for_student(uuid,text,uuid)
from public, anon, authenticated;

revoke all on function private.sf177_resolve_walkin_from_credit()
from public, anon, authenticated;
