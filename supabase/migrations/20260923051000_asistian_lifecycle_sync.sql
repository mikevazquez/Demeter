-- ASISTIAN-INBOUND-02
-- Trial students, commercial state, and booking lifecycle synchronization.

do $$
begin
  create type public.student_type as enum ('trial', 'regular');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.trial_status as enum (
    'pending',
    'attended',
    'no_show',
    'cancelled',
    'converted'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'reservation_commercial_status'
      and e.enumlabel = 'covered_by_package'
  ) then
    alter type public.reservation_commercial_status
      rename value 'covered_by_package' to 'package_covered';
  end if;

  create type public.reservation_commercial_status as enum (
    'package_covered',
    'paid',
    'payment_pending'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.asistian_sync_status as enum (
    'synced',
    'requires_attention',
    'error'
  );
exception
  when duplicate_object then null;
end
$$;

alter table public.students
  add column if not exists student_type public.student_type not null default 'regular',
  add column if not exists trial_status public.trial_status;

alter table public.reservations
  add column if not exists commercial_status public.reservation_commercial_status;

alter table public.asistian_booking_links
  alter column session_id drop not null,
  alter column reservation_id drop not null;

do $$
declare
  v_sync_type text;
begin
  select a.atttypid::regtype::text
    into v_sync_type
  from pg_attribute a
  where a.attrelid = 'public.asistian_booking_links'::regclass
    and a.attname = 'sync_status'
    and not a.attisdropped;

  if v_sync_type = 'asistian_booking_sync_status' then
    alter table public.asistian_booking_links
      alter column sync_status drop default;

    alter table public.asistian_booking_links
      alter column sync_status type public.asistian_sync_status
      using (
        case sync_status::text
          when 'synchronized' then 'synced'
          when 'requires_attention' then 'requires_attention'
          else 'error'
        end
      )::public.asistian_sync_status;

    alter table public.asistian_booking_links
      alter column sync_status set default 'synced';
  end if;
end
$$;

alter table public.asistian_booking_links
  add column if not exists sync_status public.asistian_sync_status not null default 'synced',
  add column if not exists external_status text,
  add column if not exists last_event_name text,
  add column if not exists last_event_at timestamptz,
  add column if not exists last_error_code text;

comment on column public.students.student_type is
  'Relationship with the studio. trial = first/trial-class prospect; regular = regular student.';
comment on column public.students.trial_status is
  'Progress of a trial student without overloading lifecycle_status.';
comment on column public.reservations.commercial_status is
  'How the reservation is commercially covered: package, direct payment, or pending payment.';
comment on column public.asistian_booking_links.sync_status is
  'Current synchronization health for the external Asistian booking.';

create or replace function private.asistian_promote_trial_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and not new.access_blocked
     and new.student_id is not null
     and exists (
       select 1
       from public.product_templates pt
       where pt.id = new.product_template_id
         and pt.studio_id = new.studio_id
         and pt.product_type::text in ('package', 'membership')
     ) then
    update public.students
    set student_type = 'regular',
        trial_status = case
          when student_type = 'trial' then 'converted'::public.trial_status
          else trial_status
        end,
        updated_at = now()
    where id = new.student_id
      and studio_id = new.studio_id
      and student_type = 'trial';
  end if;

  return new;
end;
$$;

drop trigger if exists asistian_promote_trial_student
  on public.product_acquisitions;

create trigger asistian_promote_trial_student
after insert or update of status, access_blocked
on public.product_acquisitions
for each row
execute function private.asistian_promote_trial_student();

create or replace function private.asistian_resolve_pending_after_acquisition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and not new.access_blocked
     and new.student_id is not null then
    perform private.sf177_resolve_walkin_commercial_pending_for_student(
      new.student_id,
      'product_acquisition',
      new.id
    );
  end if;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists asistian_resolve_pending_after_acquisition
  on public.product_acquisitions;

create trigger asistian_resolve_pending_after_acquisition
after insert or update of status, access_blocked
on public.product_acquisitions
for each row
execute function private.asistian_resolve_pending_after_acquisition();

create or replace function private.asistian_reservation_commercial_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.acquisition_id is not null
     and (new.commercial_status is null
          or new.commercial_status = 'payment_pending'::public.reservation_commercial_status) then
    new.commercial_status := 'package_covered'::public.reservation_commercial_status;
  end if;

  return new;
end;
$$;

drop trigger if exists asistian_reservation_commercial_status
  on public.reservations;

create trigger asistian_reservation_commercial_status
before insert or update of acquisition_id
on public.reservations
for each row
execute function private.asistian_reservation_commercial_status();

create or replace function public.service_sync_asistian_booking(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_booking_id text,
  target_client_id text,
  target_first_name text,
  target_last_name text,
  target_phone text,
  target_service_name text,
  target_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id text := trim(coalesce(target_booking_id, ''));
  v_client_id text := nullif(trim(coalesce(target_client_id, '')), '');
  v_first_name text := trim(coalesce(target_first_name, ''));
  v_last_name text := nullif(trim(coalesce(target_last_name, '')), '');
  v_phone text := trim(coalesce(target_phone, ''));
  v_service_name text := trim(coalesce(target_service_name, ''));
  v_existing_link public.asistian_booking_links%rowtype;
  v_student public.students%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_student_user_id uuid;
  v_student_match_count integer := 0;
  v_session public.class_sessions%rowtype;
  v_session_id uuid;
  v_session_match_count integer := 0;
  v_existing_reservation public.reservations%rowtype;
  v_reservation_id uuid;
  v_occupied integer := 0;
  v_eligibility jsonb;
  v_reason text;
  v_acquisition_id uuid;
  v_unlimited boolean := false;
  v_credit_cost integer := 1;
  v_created_student boolean := false;
  v_commercial_status public.reservation_commercial_status;
begin
  if target_studio_id is null
     or target_source_event_id is null
     or v_booking_id = ''
     or v_first_name = ''
     or v_service_name = ''
     or target_starts_at is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason_code', 'phone_invalid');
  end if;

  if not exists (
    select 1
    from public.asistian_webhook_events e
    where e.id = target_source_event_id
      and e.studio_id = target_studio_id
      and e.event_name = 'booking_created'
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_studio_id::text || ':' || v_booking_id, 0)
  );

  select *
    into v_existing_link
  from public.asistian_booking_links l
  where l.studio_id = target_studio_id
    and l.asistian_booking_id = v_booking_id
  limit 1
  for update;

  if found and v_existing_link.reservation_id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'sync_status', v_existing_link.sync_status::text,
      'created_student', false,
      'student_id', v_existing_link.student_id,
      'session_id', v_existing_link.session_id,
      'reservation_id', v_existing_link.reservation_id,
      'asistian_booking_id', v_existing_link.asistian_booking_id
    );
  end if;

  if found then
    select *
      into v_student
    from public.students s
    where s.id = v_existing_link.student_id
      and s.studio_id = target_studio_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason_code', 'linked_student_missing');
    end if;

    v_student_id := v_student.id;
    v_student_user_id := v_student.user_id;
  else
    select count(*)
      into v_student_match_count
    from public.students s
    where s.studio_id = target_studio_id
      and s.phone = v_phone;

    if v_student_match_count > 1 then
      return jsonb_build_object('ok', false, 'reason_code', 'student_phone_ambiguous');
    end if;

    if v_student_match_count = 1 then
      select *
        into v_student
      from public.students s
      where s.studio_id = target_studio_id
        and s.phone = v_phone
      limit 1
      for update;

      if not v_student.active or v_student.lifecycle_status <> 'active' then
        return jsonb_build_object('ok', false, 'reason_code', 'student_not_operable');
      end if;

      v_student_id := v_student.id;
      v_student_user_id := v_student.user_id;
    else
      select pc.person_id
        into v_person_id
      from public.person_contacts pc
      where pc.studio_id = target_studio_id
        and pc.kind = 'phone'
        and pc.value = v_phone
      limit 1;

      if v_person_id is null then
        insert into public.persons(studio_id, first_name, last_name)
        values (target_studio_id, v_first_name, v_last_name)
        returning id into v_person_id;

        insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
        values (v_person_id, target_studio_id, 'phone', v_phone, true);
      end if;

      select *
        into v_student
      from public.students s
      where s.studio_id = target_studio_id
        and s.person_id = v_person_id
      limit 1
      for update;

      if found then
        if not v_student.active or v_student.lifecycle_status <> 'active' then
          return jsonb_build_object('ok', false, 'reason_code', 'student_not_operable');
        end if;

        v_student_id := v_student.id;
        v_student_user_id := v_student.user_id;
      else
        insert into public.students(
          studio_id,
          person_id,
          full_name,
          phone,
          active,
          lifecycle_status,
          profile_status,
          student_type,
          trial_status
        )
        values (
          target_studio_id,
          v_person_id,
          trim(v_first_name || case when v_last_name is not null then ' ' || v_last_name else '' end),
          v_phone,
          true,
          'active',
          'incomplete',
          'trial',
          'pending'
        )
        returning id, user_id into v_student_id, v_student_user_id;

        update public.students
        set profile_status = private.student_profile_status(v_student_id),
            updated_at = now()
        where id = v_student_id;

        v_created_student := true;
      end if;
    end if;
  end if;

  select count(*)
    into v_session_match_count
  from public.class_sessions cs
  join public.class_templates ct
    on ct.id = cs.template_id
   and ct.studio_id = cs.studio_id
  left join public.disciplines d
    on d.id = ct.discipline_id
   and d.studio_id = cs.studio_id
  where cs.studio_id = target_studio_id
    and cs.status = 'scheduled'
    and cs.starts_at = target_starts_at
    and (
      lower(trim(ct.name)) = lower(v_service_name)
      or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
    );

  if v_session_match_count <> 1 then
    insert into public.asistian_booking_links(
      studio_id,
      asistian_booking_id,
      asistian_client_id,
      student_id,
      session_id,
      reservation_id,
      service_name,
      starts_at,
      source_event_id,
      sync_status,
      last_event_name,
      last_event_at,
      last_error_code
    )
    values (
      target_studio_id,
      v_booking_id,
      v_client_id,
      v_student_id,
      null,
      null,
      v_service_name,
      target_starts_at,
      target_source_event_id,
      'requires_attention',
      'booking_created',
      now(),
      case when v_session_match_count = 0 then 'session_not_found' else 'session_ambiguous' end
    )
    on conflict (studio_id, asistian_booking_id)
    do update set
      asistian_client_id = excluded.asistian_client_id,
      student_id = excluded.student_id,
      session_id = null,
      service_name = excluded.service_name,
      starts_at = excluded.starts_at,
      source_event_id = excluded.source_event_id,
      sync_status = 'requires_attention',
      last_event_name = excluded.last_event_name,
      last_event_at = excluded.last_event_at,
      last_error_code = excluded.last_error_code;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', case when v_session_match_count = 0 then 'session_not_found' else 'session_ambiguous' end,
      'created_student', v_created_student,
      'student_id', v_student_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  select cs.*
    into v_session
  from public.class_sessions cs
  join public.class_templates ct
    on ct.id = cs.template_id
   and ct.studio_id = cs.studio_id
  left join public.disciplines d
    on d.id = ct.discipline_id
   and d.studio_id = cs.studio_id
  where cs.studio_id = target_studio_id
    and cs.status = 'scheduled'
    and cs.starts_at = target_starts_at
    and (
      lower(trim(ct.name)) = lower(v_service_name)
      or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
    )
  limit 1
  for update of cs;

  v_session_id := v_session.id;

  if coalesce(v_session.requires_resource, false) then
    insert into public.asistian_booking_links(
      studio_id, asistian_booking_id, asistian_client_id, student_id,
      session_id, reservation_id, service_name, starts_at, source_event_id,
      sync_status, last_event_name, last_event_at, last_error_code
    )
    values (
      target_studio_id, v_booking_id, v_client_id, v_student_id,
      v_session_id, null, v_service_name, target_starts_at, target_source_event_id,
      'requires_attention', 'booking_created', now(), 'resource_selection_required'
    )
    on conflict (studio_id, asistian_booking_id)
    do update set
      asistian_client_id = excluded.asistian_client_id,
      student_id = excluded.student_id,
      session_id = excluded.session_id,
      service_name = excluded.service_name,
      starts_at = excluded.starts_at,
      source_event_id = excluded.source_event_id,
      sync_status = 'requires_attention',
      last_event_name = excluded.last_event_name,
      last_event_at = excluded.last_event_at,
      last_error_code = excluded.last_error_code;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'resource_selection_required',
      'created_student', v_created_student,
      'student_id', v_student_id,
      'session_id', v_session_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  select *
    into v_existing_reservation
  from public.reservations r
  where r.session_id = v_session_id
    and r.student_id = v_student_id
    and r.status in ('reserved', 'attended')
  limit 1
  for update;

  if found then
    if v_existing_reservation.commercial_status is null then
      update public.reservations
      set commercial_status = case
        when v_existing_reservation.acquisition_id is not null
          then 'package_covered'::public.reservation_commercial_status
        else 'payment_pending'::public.reservation_commercial_status
      end,
      updated_at = now()
      where id = v_existing_reservation.id;
    end if;

    insert into public.asistian_booking_links(
      studio_id, asistian_booking_id, asistian_client_id, student_id,
      session_id, reservation_id, service_name, starts_at, source_event_id,
      sync_status, last_event_name, last_event_at, last_error_code
    )
    values (
      target_studio_id, v_booking_id, v_client_id, v_student_id,
      v_session_id, v_existing_reservation.id, v_service_name, target_starts_at, target_source_event_id,
      'synced', 'booking_created', now(), null
    )
    on conflict (studio_id, asistian_booking_id)
    do update set
      asistian_client_id = excluded.asistian_client_id,
      student_id = excluded.student_id,
      session_id = excluded.session_id,
      reservation_id = excluded.reservation_id,
      service_name = excluded.service_name,
      starts_at = excluded.starts_at,
      source_event_id = excluded.source_event_id,
      sync_status = 'synced',
      last_event_name = excluded.last_event_name,
      last_event_at = excluded.last_event_at,
      last_error_code = null;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'sync_status', 'synced',
      'existing_reservation', true,
      'created_student', v_created_student,
      'student_id', v_student_id,
      'session_id', v_session_id,
      'reservation_id', v_existing_reservation.id,
      'commercial_status',
        coalesce(
          v_existing_reservation.commercial_status::text,
          case when v_existing_reservation.acquisition_id is not null then 'package_covered' else 'payment_pending' end
        ),
      'asistian_booking_id', v_booking_id
    );
  end if;

  select count(*)
    into v_occupied
  from public.reservations r
  where r.session_id = v_session_id
    and r.status in ('reserved', 'attended');

  if v_occupied >= v_session.capacity then
    insert into public.asistian_booking_links(
      studio_id, asistian_booking_id, asistian_client_id, student_id,
      session_id, reservation_id, service_name, starts_at, source_event_id,
      sync_status, last_event_name, last_event_at, last_error_code
    )
    values (
      target_studio_id, v_booking_id, v_client_id, v_student_id,
      v_session_id, null, v_service_name, target_starts_at, target_source_event_id,
      'requires_attention', 'booking_created', now(), 'session_full'
    )
    on conflict (studio_id, asistian_booking_id)
    do update set
      session_id = excluded.session_id,
      service_name = excluded.service_name,
      starts_at = excluded.starts_at,
      source_event_id = excluded.source_event_id,
      sync_status = 'requires_attention',
      last_event_name = excluded.last_event_name,
      last_event_at = excluded.last_event_at,
      last_error_code = excluded.last_error_code;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'session_full',
      'student_id', v_student_id,
      'session_id', v_session_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  v_eligibility := private.booking_eligibility_core(
    v_session_id,
    v_student_id,
    true
  );

  if coalesce((v_eligibility->>'eligible')::boolean, false) then
    v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
    v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
    v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);
    v_commercial_status := 'package_covered';

    perform 1
    from public.product_acquisitions pa
    where pa.id = v_acquisition_id
      and pa.studio_id = target_studio_id
      and pa.student_id = v_student_id
      and pa.status = 'active'
      and not pa.access_blocked
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason_code', 'acquisition_not_found');
    end if;

    if not v_unlimited then
      if coalesce((
        select sum(cl.quantity)::integer
        from public.credit_ledger cl
        where cl.acquisition_id = v_acquisition_id
      ), 0) < v_credit_cost then
        v_acquisition_id := null;
        v_commercial_status := 'payment_pending';
        v_reason := 'no_credits';
      end if;
    end if;
  else
    v_reason := coalesce(v_eligibility->>'reason_code', 'commercial_coverage_missing');
    v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);

    if v_reason not in (
      'no_active_product',
      'outside_product',
      'no_credits',
      'payment_pending',
      'enrollment_required'
    ) then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_event_name = 'booking_created',
          last_event_at = now(),
          last_error_code = v_reason,
          source_event_id = target_source_event_id
      where studio_id = target_studio_id
        and asistian_booking_id = v_booking_id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', v_reason,
        'student_id', v_student_id,
        'session_id', v_session_id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    v_acquisition_id := null;
    v_unlimited := false;
    v_commercial_status := 'payment_pending';
  end if;

  insert into public.reservations(
    studio_id,
    session_id,
    student_id,
    student_user_id,
    acquisition_id,
    status,
    credits_held,
    commercial_status
  )
  values (
    target_studio_id,
    v_session_id,
    v_student_id,
    v_student_user_id,
    v_acquisition_id,
    'reserved',
    v_credit_cost,
    v_commercial_status
  )
  returning id into v_reservation_id;

  if v_acquisition_id is not null and not v_unlimited then
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
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados desde Asistian', v_credit_cost),
      null
    );
  end if;

  if v_commercial_status = 'payment_pending' then
    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'walkin.commercial_pending',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation_id,
      p_deduplication_key => 'walkin.commercial_pending:' || v_reservation_id::text,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'student_id', v_student_id,
        'session_id', v_session_id,
        'reason_code', coalesce(v_reason, 'no_active_product'),
        'credit_cost', v_credit_cost,
        'walkin', false,
        'source', 'asistian',
        'asistian_booking_id', v_booking_id,
        'commercial_pending', true
      )
    );
  end if;

  perform public.emit_domain_event(
    p_studio_id => target_studio_id,
    p_event_type => 'booking.created',
    p_source_entity_type => 'reservation',
    p_source_entity_id => v_reservation_id,
    p_deduplication_key => 'booking.created:asistian:' || v_booking_id,
    p_actor_user_id => null,
    p_payload => jsonb_build_object(
      'reservation_id', v_reservation_id,
      'session_id', v_session_id,
      'student_id', v_student_id,
      'acquisition_id', v_acquisition_id,
      'credit_cost', v_credit_cost,
      'unlimited', v_unlimited,
      'source', 'asistian',
      'asistian_booking_id', v_booking_id,
      'commercial_status', v_commercial_status::text
    )
  );

  insert into public.asistian_booking_links(
    studio_id,
    asistian_booking_id,
    asistian_client_id,
    student_id,
    session_id,
    reservation_id,
    service_name,
    starts_at,
    source_event_id,
    sync_status,
    last_event_name,
    last_event_at,
    last_error_code
  )
  values (
    target_studio_id,
    v_booking_id,
    v_client_id,
    v_student_id,
    v_session_id,
    v_reservation_id,
    v_service_name,
    target_starts_at,
    target_source_event_id,
    'synced',
    'booking_created',
    now(),
    null
  )
  on conflict (studio_id, asistian_booking_id)
  do update set
    asistian_client_id = excluded.asistian_client_id,
    student_id = excluded.student_id,
    session_id = excluded.session_id,
    reservation_id = excluded.reservation_id,
    service_name = excluded.service_name,
    starts_at = excluded.starts_at,
    source_event_id = excluded.source_event_id,
    sync_status = 'synced',
    last_event_name = excluded.last_event_name,
    last_event_at = excluded.last_event_at,
    last_error_code = null;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'sync_status', 'synced',
    'created_student', v_created_student,
    'student_type', case when v_created_student then 'trial' else v_student.student_type::text end,
    'commercial_status', v_commercial_status::text,
    'commercial_pending', v_commercial_status = 'payment_pending',
    'student_id', v_student_id,
    'session_id', v_session_id,
    'reservation_id', v_reservation_id,
    'acquisition_id', v_acquisition_id,
    'asistian_booking_id', v_booking_id
  );
end;
$$;

revoke all on function public.service_sync_asistian_booking(
  uuid,uuid,text,text,text,text,text,text,timestamptz
)
from public, anon, authenticated;
grant execute on function public.service_sync_asistian_booking(
  uuid,uuid,text,text,text,text,text,text,timestamptz
)
to service_role;

create or replace function public.service_apply_asistian_booking_event(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_event_name text,
  target_booking_id text,
  target_service_name text,
  target_starts_at timestamptz,
  target_external_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text := lower(trim(coalesce(target_event_name, '')));
  v_booking_id text := trim(coalesce(target_booking_id, ''));
  v_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_external_status text := lower(trim(coalesce(target_external_status, '')));
  v_link public.asistian_booking_links%rowtype;
  v_reservation public.reservations%rowtype;
  v_old_session public.class_sessions%rowtype;
  v_target_session public.class_sessions%rowtype;
  v_target_count integer := 0;
  v_occupied integer := 0;
  v_new_status public.reservation_status;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer := 1;
  v_coverage jsonb;
  v_new_acquisition_id uuid;
  v_new_unlimited boolean := false;
  v_new_credit_cost integer := 1;
  v_has_reservation boolean := false;
begin
  if target_studio_id is null
     or target_source_event_id is null
     or v_event = ''
     or v_booking_id = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.asistian_webhook_events e
    where e.id = target_source_event_id
      and e.studio_id = target_studio_id
      and e.event_name = v_event
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_studio_id::text || ':' || v_booking_id, 0)
  );

  select *
    into v_link
  from public.asistian_booking_links l
  where l.studio_id = target_studio_id
    and l.asistian_booking_id = v_booking_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'booking_link_not_found',
      'asistian_booking_id', v_booking_id
    );
  end if;

  update public.asistian_booking_links
  set external_status = nullif(target_external_status, ''),
      last_event_name = v_event,
      last_event_at = now(),
      source_event_id = target_source_event_id
  where id = v_link.id;

  if v_link.reservation_id is not null then
    select *
      into v_reservation
    from public.reservations r
    where r.id = v_link.reservation_id
      and r.studio_id = target_studio_id
    for update;
    v_has_reservation := found;
  end if;

  if v_event = 'booking_rescheduled' then
    if v_service_name is null or target_starts_at is null then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'reschedule_context_incomplete'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reschedule_context_incomplete',
        'asistian_booking_id', v_booking_id
      );
    end if;

    select count(*)
      into v_target_count
    from public.class_sessions cs
    join public.class_templates ct
      on ct.id = cs.template_id
     and ct.studio_id = cs.studio_id
    left join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = cs.studio_id
    where cs.studio_id = target_studio_id
      and cs.status = 'scheduled'
      and cs.starts_at = target_starts_at
      and (
        lower(trim(ct.name)) = lower(v_service_name)
        or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
      );

    if v_target_count <> 1 then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = case when v_target_count = 0 then 'session_not_found' else 'session_ambiguous' end
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', case when v_target_count = 0 then 'session_not_found' else 'session_ambiguous' end,
        'asistian_booking_id', v_booking_id
      );
    end if;

    select cs.*
      into v_target_session
    from public.class_sessions cs
    join public.class_templates ct
      on ct.id = cs.template_id
     and ct.studio_id = cs.studio_id
    left join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = cs.studio_id
    where cs.studio_id = target_studio_id
      and cs.status = 'scheduled'
      and cs.starts_at = target_starts_at
      and (
        lower(trim(ct.name)) = lower(v_service_name)
        or lower(trim(coalesce(d.name, ''))) = lower(v_service_name)
      )
    limit 1
    for update of cs;

    if coalesce(v_target_session.requires_resource, false) then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = 'resource_selection_required'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'resource_selection_required',
        'target_session_id', v_target_session.id,
        'reservation_id', v_link.reservation_id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_link.reservation_id is null or not v_has_reservation then
      update public.asistian_booking_links
      set session_id = v_target_session.id,
          service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          last_error_code = 'local_reservation_missing'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'local_reservation_missing',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.status <> 'reserved' then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'reservation_not_reschedulable'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reservation_not_reschedulable',
        'reservation_id', v_reservation.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if exists (
      select 1
      from public.reservations r
      where r.session_id = v_target_session.id
        and r.student_id = v_reservation.student_id
        and r.status in ('reserved', 'attended')
        and r.id <> v_reservation.id
    ) then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'already_reserved_target_session'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'already_reserved_target_session',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    select count(*)
      into v_occupied
    from public.reservations r
    where r.session_id = v_target_session.id
      and r.status in ('reserved', 'attended')
      and r.id <> v_reservation.id;

    if v_occupied >= v_target_session.capacity then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'session_full'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'session_full',
        'target_session_id', v_target_session.id,
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.acquisition_id is not null then
      v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

      if v_link.session_id <> v_target_session.id then
        update public.reservations
        set session_id = v_target_session.id,
            updated_at = now()
        where id = v_reservation.id;

        v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

        if not coalesce((v_coverage->>'covered')::boolean, false)
           or (v_coverage->>'acquisition_id')::uuid <> v_reservation.acquisition_id
           or greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1)
              <> greatest(coalesce(v_reservation.credits_held, 1), 1) then
          update public.reservations
          set session_id = v_link.session_id,
              updated_at = now()
          where id = v_reservation.id;

          update public.asistian_booking_links
          set sync_status = 'requires_attention',
              last_error_code = case
                when coalesce((v_coverage->>'covered')::boolean, false)
                     and (v_coverage->>'acquisition_id')::uuid = v_reservation.acquisition_id
                  then 'credit_cost_changed'
                else 'package_not_valid_for_reschedule'
              end
          where id = v_link.id;

          return jsonb_build_object(
            'ok', true,
            'sync_status', 'requires_attention',
            'reason_code', case
              when coalesce((v_coverage->>'covered')::boolean, false)
                   and (v_coverage->>'acquisition_id')::uuid = v_reservation.acquisition_id
                then 'credit_cost_changed'
              else 'package_not_valid_for_reschedule'
            end,
            'reservation_id', v_reservation.id,
            'asistian_booking_id', v_booking_id
          );
        end if;
      end if;
    else
      update public.reservations
      set session_id = v_target_session.id,
          updated_at = now()
      where id = v_reservation.id;

      v_coverage := private.sf177_walkin_commercial_coverage(v_reservation.id);

      if coalesce((v_coverage->>'covered')::boolean, false) then
        v_new_acquisition_id := (v_coverage->>'acquisition_id')::uuid;
        v_new_unlimited := coalesce((v_coverage->>'unlimited')::boolean, false);
        v_new_credit_cost := greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1);

        perform 1
        from public.product_acquisitions pa
        where pa.id = v_new_acquisition_id
        for update;

        update public.reservations
        set acquisition_id = v_new_acquisition_id,
            credits_held = v_new_credit_cost,
            commercial_status = 'package_covered',
            updated_at = now()
        where id = v_reservation.id;

        if not v_new_unlimited then
          insert into public.credit_ledger(
            studio_id, acquisition_id, movement_type, quantity,
            reservation_id, note, created_by
          )
          values (
            target_studio_id, v_new_acquisition_id, 'reserve', -v_new_credit_cost,
            v_reservation.id, format('%s crédito(s) reservados al reprogramar desde Asistian', v_new_credit_cost), null
          )
          on conflict (reservation_id, movement_type) do nothing;
        end if;
      end if;
    end if;

    update public.reservation_resource_assignments
    set released_at = now(),
        release_reason = 'asistian_rescheduled'
    where reservation_id = v_reservation.id
      and released_at is null
      and session_id <> v_target_session.id;

    update public.asistian_booking_links
    set session_id = v_target_session.id,
        service_name = v_service_name,
        starts_at = target_starts_at,
        sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', 'rescheduled',
      'reservation_id', v_reservation.id,
      'session_id', v_target_session.id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  if v_event = 'booking_cancelled'
     or (
       v_event = 'booking_status_changed'
       and v_external_status in ('cancelled', 'canceled')
     ) then
    if v_link.reservation_id is not null and v_has_reservation and v_reservation.status = 'reserved' then
      select *
        into v_old_session
      from public.class_sessions cs
      where cs.id = v_reservation.session_id
      for update;

      v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
      v_new_status := private.reservation_cancellation_outcome(v_old_session.starts_at);

      update public.reservations
      set status = v_new_status,
          cancelled_at = now(),
          cancellation_reason = 'asistian:' || v_booking_id,
          cancelled_by = null,
          updated_at = now()
      where id = v_reservation.id;

      if v_reservation.acquisition_id is not null then
        select *
          into v_acquisition
        from public.product_acquisitions pa
        where pa.id = v_reservation.acquisition_id
        for update;

        if found and not v_acquisition.unlimited then
          insert into public.credit_ledger(
            studio_id, acquisition_id, movement_type, quantity,
            reservation_id, note, created_by
          )
          values (
            target_studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
            v_reservation.id,
            case
              when v_new_status = 'cancelled_on_time'
                then format('%s crédito(s) devueltos por cancelación Asistian a tiempo', v_credit_cost)
              else format('Cierre del hold de %s crédito(s) por cancelación Asistian tardía', v_credit_cost)
            end,
            null
          )
          on conflict (reservation_id, movement_type) do nothing;

          if v_new_status = 'cancelled_late' then
            insert into public.credit_ledger(
              studio_id, acquisition_id, movement_type, quantity,
              reservation_id, note, created_by
            )
            values (
              target_studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
              v_reservation.id,
              format('%s crédito(s) consumidos por cancelación Asistian tardía', v_credit_cost),
              null
            )
            on conflict (reservation_id, movement_type) do nothing;
          end if;
        end if;

        if v_new_status = 'cancelled_late' then
          perform private.activate_acquisition_on_first_usage(
            v_reservation.acquisition_id,
            v_reservation.id
          );
        end if;
      end if;
    end if;

    update public.students
    set trial_status = 'cancelled',
        updated_at = now()
    where id = v_link.student_id
      and student_type = 'trial';

    update public.asistian_booking_links
    set sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', 'cancelled',
      'reservation_id', v_link.reservation_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  if v_event in ('booking_no_show', 'booking_completed')
     or (
       v_event = 'booking_status_changed'
       and v_external_status in ('no_show', 'noshow', 'completed', 'attended', 'done')
     ) then
    if v_link.reservation_id is null or not v_has_reservation then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          last_error_code = 'local_reservation_missing'
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'local_reservation_missing',
        'asistian_booking_id', v_booking_id
      );
    end if;

    if v_reservation.status = 'reserved' then
      v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
      v_new_status := case
        when v_event = 'booking_no_show'
          or v_external_status in ('no_show', 'noshow')
          then 'no_show'::public.reservation_status
        else 'attended'::public.reservation_status
      end;

      update public.reservations
      set status = v_new_status,
          updated_at = now()
      where id = v_reservation.id;

      if v_reservation.acquisition_id is not null then
        select *
          into v_acquisition
        from public.product_acquisitions pa
        where pa.id = v_reservation.acquisition_id
        for update;

        if found and not v_acquisition.unlimited then
          if exists (
            select 1
            from public.credit_ledger cl
            where cl.reservation_id = v_reservation.id
              and cl.movement_type = 'reserve'
          ) then
            insert into public.credit_ledger(
              studio_id, acquisition_id, movement_type, quantity,
              reservation_id, note, created_by
            )
            values (
              target_studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
              v_reservation.id,
              format('Cierre del hold de %s crédito(s) por estado Asistian', v_credit_cost),
              null
            )
            on conflict (reservation_id, movement_type) do nothing;
          end if;

          insert into public.credit_ledger(
            studio_id, acquisition_id, movement_type, quantity,
            reservation_id, note, created_by
          )
          values (
            target_studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
            v_reservation.id,
            case
              when v_new_status = 'attended'
                then format('%s crédito(s) consumidos por asistencia Asistian', v_credit_cost)
              else format('%s crédito(s) consumidos por no-show Asistian', v_credit_cost)
            end,
            null
          )
          on conflict (reservation_id, movement_type) do nothing;
        end if;

        perform private.activate_acquisition_on_first_usage(
          v_reservation.acquisition_id,
          v_reservation.id
        );
      end if;

      update public.students
      set trial_status = case
            when v_new_status = 'attended' then 'attended'::public.trial_status
            else 'no_show'::public.trial_status
          end,
          updated_at = now()
      where id = v_link.student_id
        and student_type = 'trial';
    end if;

    update public.asistian_booking_links
    set sync_status = 'synced',
        last_error_code = null
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synced',
      'action', case
        when v_event = 'booking_no_show' or v_external_status in ('no_show', 'noshow')
          then 'no_show'
        else 'attended'
      end,
      'reservation_id', v_link.reservation_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  update public.asistian_booking_links
  set sync_status = 'synced',
      last_error_code = null
  where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'sync_status', 'synced',
    'action', case
      when v_event = 'booking_confirmed' then 'confirmed'
      when v_event = 'booking_updated' then 'metadata_updated'
      when v_event = 'booking_status_changed' then 'status_recorded'
      else 'recorded'
    end,
    'reservation_id', v_link.reservation_id,
    'asistian_booking_id', v_booking_id
  );
end;
$$;

revoke all on function public.service_apply_asistian_booking_event(
  uuid,uuid,text,text,text,timestamptz,text
)
from public, anon, authenticated;
grant execute on function public.service_apply_asistian_booking_event(
  uuid,uuid,text,text,text,timestamptz,text
)
to service_role;
