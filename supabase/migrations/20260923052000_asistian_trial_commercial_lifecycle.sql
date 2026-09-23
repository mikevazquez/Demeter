-- ASISTIAN-INBOUND-02
-- Trial-student classification, commercial status, and lifecycle synchronization.

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'student_relationship_type'
  ) then
    create type public.student_relationship_type as enum ('trial', 'regular');
  end if;

  if not exists (
    select 1 from pg_type where typname = 'reservation_commercial_status'
  ) then
    create type public.reservation_commercial_status as enum (
      'covered_by_package',
      'paid',
      'payment_pending'
    );
  end if;

  if not exists (
    select 1 from pg_type where typname = 'asistian_booking_sync_status'
  ) then
    create type public.asistian_booking_sync_status as enum (
      'synchronized',
      'requires_attention',
      'error'
    );
  end if;
end
$$;

alter table public.students
  add column if not exists relationship_type public.student_relationship_type
    not null default 'regular';

alter table public.reservations
  add column if not exists commercial_status public.reservation_commercial_status,
  add column if not exists booking_source text not null default 'studio_flow';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_booking_source_chk'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_booking_source_chk
      check (booking_source in ('studio_flow', 'asistian')) not valid;
  end if;
end
$$;

alter table public.asistian_booking_links
  alter column session_id drop not null,
  alter column reservation_id drop not null,
  add column if not exists student_created_by_asistian boolean not null default false,
  add column if not exists sync_status public.asistian_booking_sync_status
    not null default 'synchronized',
  add column if not exists attention_reason text,
  add column if not exists last_event_name text,
  add column if not exists last_source_event_id uuid
    references public.asistian_webhook_events(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists asistian_booking_links_attention_idx
  on public.asistian_booking_links(studio_id, sync_status, updated_at desc);

create or replace function private.promote_trial_student_on_product_acquisition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and not coalesce(new.access_blocked, false) then
    update public.students s
    set relationship_type = 'regular',
        updated_at = now()
    from public.product_templates pt
    where s.id = new.student_id
      and s.studio_id = new.studio_id
      and s.relationship_type = 'trial'
      and pt.id = new.product_template_id
      and pt.studio_id = new.studio_id
      and pt.product_type::text in ('package', 'membership');
  end if;

  return new;
end;
$$;

drop trigger if exists asistian_promote_trial_after_product_acquisition
  on public.product_acquisitions;

create trigger asistian_promote_trial_after_product_acquisition
after insert or update of status, access_blocked, product_template_id
on public.product_acquisitions
for each row
execute function private.promote_trial_student_on_product_acquisition();

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
  v_link public.asistian_booking_links%rowtype;
  v_student public.students%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_student_user_id uuid;
  v_student_match_count integer := 0;
  v_created_student boolean := false;
  v_session public.class_sessions%rowtype;
  v_session_id uuid;
  v_session_match_count integer := 0;
  v_existing_reservation_id uuid;
  v_reservation_id uuid;
  v_occupied integer := 0;
  v_eligibility jsonb;
  v_reason text;
  v_acquisition_id uuid;
  v_unlimited boolean := false;
  v_credit_cost integer := 1;
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
    into v_link
  from public.asistian_booking_links l
  where l.studio_id = target_studio_id
    and l.asistian_booking_id = v_booking_id
  for update;

  if found and v_link.reservation_id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'sync_status', v_link.sync_status::text,
      'student_id', v_link.student_id,
      'session_id', v_link.session_id,
      'reservation_id', v_link.reservation_id,
      'asistian_booking_id', v_link.asistian_booking_id
    );
  end if;

  if found then
    v_student_id := v_link.student_id;

    select *
      into v_student
    from public.students s
    where s.id = v_student_id
      and s.studio_id = target_studio_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason_code', 'linked_student_missing');
    end if;

    v_student_user_id := v_student.user_id;
    v_created_student := v_link.student_created_by_asistian;
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
          relationship_type
        )
        values (
          target_studio_id,
          v_person_id,
          trim(v_first_name || case when v_last_name is not null then ' ' || v_last_name else '' end),
          v_phone,
          true,
          'active',
          'incomplete',
          'trial'
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

  if v_session_match_count = 0 then
    if v_link.id is null then
      insert into public.asistian_booking_links(
        studio_id, asistian_booking_id, asistian_client_id, student_id,
        session_id, reservation_id, service_name, starts_at, source_event_id,
        student_created_by_asistian, sync_status, attention_reason,
        last_event_name, last_source_event_id
      ) values (
        target_studio_id, v_booking_id, v_client_id, v_student_id,
        null, null, v_service_name, target_starts_at, target_source_event_id,
        v_created_student, 'requires_attention', 'session_not_found',
        'booking_created', target_source_event_id
      );
    else
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          attention_reason = 'session_not_found',
          last_event_name = 'booking_created',
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'session_not_found',
      'student_id', v_student_id,
      'created_student', v_created_student
    );
  end if;

  if v_session_match_count > 1 then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'session_ambiguous',
      'student_id', v_student_id
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
    if v_link.id is null then
      insert into public.asistian_booking_links(
        studio_id, asistian_booking_id, asistian_client_id, student_id,
        session_id, reservation_id, service_name, starts_at, source_event_id,
        student_created_by_asistian, sync_status, attention_reason,
        last_event_name, last_source_event_id
      ) values (
        target_studio_id, v_booking_id, v_client_id, v_student_id,
        v_session_id, null, v_service_name, target_starts_at, target_source_event_id,
        v_created_student, 'requires_attention', 'resource_selection_required',
        'booking_created', target_source_event_id
      );
    else
      update public.asistian_booking_links
      set session_id = v_session_id,
          service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'requires_attention',
          attention_reason = 'resource_selection_required',
          last_event_name = 'booking_created',
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'resource_selection_required',
      'student_id', v_student_id,
      'session_id', v_session_id,
      'created_student', v_created_student
    );
  end if;

  select r.id
    into v_existing_reservation_id
  from public.reservations r
  where r.session_id = v_session_id
    and r.student_id = v_student_id
    and r.status in ('reserved', 'attended')
  limit 1;

  if v_existing_reservation_id is not null then
    if v_link.id is null then
      insert into public.asistian_booking_links(
        studio_id, asistian_booking_id, asistian_client_id, student_id,
        session_id, reservation_id, service_name, starts_at, source_event_id,
        student_created_by_asistian, sync_status, attention_reason,
        last_event_name, last_source_event_id
      ) values (
        target_studio_id, v_booking_id, v_client_id, v_student_id,
        v_session_id, v_existing_reservation_id, v_service_name, target_starts_at,
        target_source_event_id, v_created_student, 'synchronized', null,
        'booking_created', target_source_event_id
      );
    else
      update public.asistian_booking_links
      set session_id = v_session_id,
          reservation_id = v_existing_reservation_id,
          service_name = v_service_name,
          starts_at = target_starts_at,
          sync_status = 'synchronized',
          attention_reason = null,
          last_event_name = 'booking_created',
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'existing_reservation', true,
      'sync_status', 'synchronized',
      'created_student', v_created_student,
      'student_id', v_student_id,
      'session_id', v_session_id,
      'reservation_id', v_existing_reservation_id,
      'asistian_booking_id', v_booking_id
    );
  end if;

  select count(*)
    into v_occupied
  from public.reservations r
  where r.session_id = v_session_id
    and r.status in ('reserved', 'attended');

  if v_occupied >= v_session.capacity then
    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'session_full',
      'student_id', v_student_id,
      'session_id', v_session_id
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
    v_commercial_status := 'covered_by_package';

    perform 1
    from public.product_acquisitions pa
    where pa.id = v_acquisition_id
      and pa.studio_id = target_studio_id
      and pa.student_id = v_student_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason_code', 'acquisition_not_found');
    end if;
  else
    v_reason := coalesce(v_eligibility->>'reason_code', 'commercial_coverage_missing');

    if v_reason not in (
      'no_active_product',
      'outside_product',
      'no_credits',
      'payment_pending',
      'enrollment_required'
    ) then
      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', v_reason,
        'student_id', v_student_id,
        'session_id', v_session_id
      );
    end if;

    v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);
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
    commercial_status,
    booking_source
  )
  values (
    target_studio_id,
    v_session_id,
    v_student_id,
    v_student_user_id,
    v_acquisition_id,
    'reserved',
    v_credit_cost,
    v_commercial_status,
    'asistian'
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
      format('%s crédito(s) reservados por sincronización Asistian', v_credit_cost),
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
        'reason_code', v_reason,
        'credit_cost', v_credit_cost,
        'walkin', false,
        'commercial_pending', true,
        'source', 'asistian',
        'asistian_booking_id', v_booking_id
      )
    );
  end if;

  perform public.emit_domain_event(
    p_studio_id => target_studio_id,
    p_event_type => 'integration.asistian.booking_synced',
    p_source_entity_type => 'reservation',
    p_source_entity_id => v_reservation_id,
    p_deduplication_key => 'integration.asistian.booking_synced:' || v_booking_id,
    p_actor_user_id => null,
    p_payload => jsonb_build_object(
      'student_id', v_student_id,
      'session_id', v_session_id,
      'reservation_id', v_reservation_id,
      'asistian_booking_id', v_booking_id,
      'commercial_status', v_commercial_status::text,
      'created_student', v_created_student
    )
  );

  if v_link.id is null then
    insert into public.asistian_booking_links(
      studio_id, asistian_booking_id, asistian_client_id, student_id,
      session_id, reservation_id, service_name, starts_at, source_event_id,
      student_created_by_asistian, sync_status, attention_reason,
      last_event_name, last_source_event_id
    )
    values (
      target_studio_id, v_booking_id, v_client_id, v_student_id,
      v_session_id, v_reservation_id, v_service_name, target_starts_at,
      target_source_event_id, v_created_student, 'synchronized', null,
      'booking_created', target_source_event_id
    );
  else
    update public.asistian_booking_links
    set session_id = v_session_id,
        reservation_id = v_reservation_id,
        service_name = v_service_name,
        starts_at = target_starts_at,
        sync_status = 'synchronized',
        attention_reason = null,
        last_event_name = 'booking_created',
        last_source_event_id = target_source_event_id,
        updated_at = now()
    where id = v_link.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'sync_status', 'synchronized',
    'created_student', v_created_student,
    'student_relationship_type', case when v_created_student then 'trial' else v_student.relationship_type::text end,
    'commercial_status', v_commercial_status::text,
    'commercial_pending', v_commercial_status = 'payment_pending',
    'acquisition_id', v_acquisition_id,
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost,
    'student_id', v_student_id,
    'session_id', v_session_id,
    'reservation_id', v_reservation_id,
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

create or replace function public.service_apply_asistian_booking_change(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_event_name text,
  target_booking_id text,
  target_service_name text,
  target_starts_at timestamptz,
  target_booking_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_name text := trim(coalesce(target_event_name, ''));
  v_booking_id text := trim(coalesce(target_booking_id, ''));
  v_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_booking_status text := lower(trim(coalesce(target_booking_status, '')));
  v_link public.asistian_booking_links%rowtype;
  v_reservation public.reservations%rowtype;
  v_old_session public.class_sessions%rowtype;
  v_new_session public.class_sessions%rowtype;
  v_new_session_id uuid;
  v_new_match_count integer := 0;
  v_new_credit_cost integer := 1;
  v_new_discipline_id uuid;
  v_class_date date;
  v_timezone text;
  v_same_acquisition_valid boolean := false;
  v_occupied integer := 0;
  v_new_status public.reservation_status;
  v_acquisition public.product_acquisitions%rowtype;
  v_existing_reserve integer := 0;
begin
  if target_studio_id is null
     or target_source_event_id is null
     or v_event_name = ''
     or v_booking_id = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.asistian_webhook_events e
    where e.id = target_source_event_id
      and e.studio_id = target_studio_id
      and e.event_name = v_event_name
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
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'sync_status', 'requires_attention',
      'reason_code', 'booking_link_not_found'
    );
  end if;

  if v_event_name = 'booking_cancelled'
     or (
       v_event_name = 'booking_status_changed'
       and v_booking_status in ('cancelled', 'canceled')
     ) then
    if v_link.reservation_id is null then
      update public.asistian_booking_links
      set sync_status = 'synchronized',
          attention_reason = null,
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'synchronized',
        'cancelled', true,
        'local_reservation_existed', false
      );
    end if;

    select *
      into v_reservation
    from public.reservations r
    where r.id = v_link.reservation_id
      and r.studio_id = target_studio_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason_code', 'linked_reservation_missing');
    end if;

    if v_reservation.status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
      update public.asistian_booking_links
      set sync_status = 'synchronized',
          attention_reason = null,
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'synchronized',
        'cancelled', true,
        'reused', true,
        'reservation_id', v_reservation.id,
        'status', v_reservation.status::text
      );
    end if;

    if v_reservation.status <> 'reserved' then
      update public.asistian_booking_links
      set sync_status = 'requires_attention',
          attention_reason = 'reservation_not_cancellable',
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reservation_not_cancellable',
        'reservation_id', v_reservation.id,
        'status', v_reservation.status::text
      );
    end if;

    select *
      into v_old_session
    from public.class_sessions cs
    where cs.id = v_reservation.session_id;

    v_new_status := private.reservation_cancellation_outcome(v_old_session.starts_at);

    update public.reservations
    set status = v_new_status,
        cancelled_at = now(),
        cancellation_reason = 'Cancelada desde Asistian',
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
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'release',
          greatest(coalesce(v_reservation.credits_held, 1), 1),
          v_reservation.id,
          case
            when v_new_status = 'cancelled_on_time'
              then 'Crédito devuelto por cancelación sincronizada desde Asistian'
            else 'Cierre del hold por cancelación tardía sincronizada desde Asistian'
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
            v_reservation.studio_id,
            v_reservation.acquisition_id,
            'consume',
            -greatest(coalesce(v_reservation.credits_held, 1), 1),
            v_reservation.id,
            'Crédito consumido por cancelación tardía sincronizada desde Asistian',
            null
          )
          on conflict (reservation_id, movement_type) do nothing;

          perform private.activate_acquisition_on_first_usage(
            v_reservation.acquisition_id,
            v_reservation.id
          );
        end if;
      end if;
    end if;

    update public.asistian_booking_links
    set sync_status = 'synchronized',
        attention_reason = null,
        last_event_name = v_event_name,
        last_source_event_id = target_source_event_id,
        updated_at = now()
    where id = v_link.id;

    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'integration.asistian.booking_cancelled',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation.id,
      p_deduplication_key => 'integration.asistian.booking_cancelled:' || target_source_event_id::text,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'asistian_booking_id', v_booking_id,
        'reservation_id', v_reservation.id,
        'status', v_new_status::text
      )
    );

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synchronized',
      'cancelled', true,
      'reservation_id', v_reservation.id,
      'status', v_new_status::text
    );
  end if;

  if v_event_name = 'booking_rescheduled'
     or (
       v_event_name in ('booking_updated', 'booking_status_changed')
       and target_starts_at is not null
       and (
         target_starts_at is distinct from v_link.starts_at
         or (
           v_service_name is not null
           and lower(v_service_name) <> lower(v_link.service_name)
         )
       )
     ) then
    if target_starts_at is null or v_service_name is null then
      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reschedule_context_incomplete'
      );
    end if;

    select count(*)
      into v_new_match_count
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

    if v_new_match_count <> 1 then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          session_id = null,
          sync_status = 'requires_attention',
          attention_reason = case
            when v_new_match_count = 0 then 'session_not_found'
            else 'session_ambiguous'
          end,
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', case
          when v_new_match_count = 0 then 'session_not_found'
          else 'session_ambiguous'
        end
      );
    end if;

    select cs.*, ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
      into v_new_session, v_new_discipline_id, v_new_credit_cost
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

    v_new_session_id := v_new_session.id;

    if coalesce(v_new_session.requires_resource, false) then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          session_id = v_new_session_id,
          sync_status = 'requires_attention',
          attention_reason = 'resource_selection_required',
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'resource_selection_required',
        'session_id', v_new_session_id
      );
    end if;

    if v_link.reservation_id is null then
      update public.asistian_booking_links
      set service_name = v_service_name,
          starts_at = target_starts_at,
          session_id = v_new_session_id,
          sync_status = 'requires_attention',
          attention_reason = 'local_reservation_missing',
          last_event_name = v_event_name,
          last_source_event_id = target_source_event_id,
          updated_at = now()
      where id = v_link.id;

      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'local_reservation_missing',
        'session_id', v_new_session_id
      );
    end if;

    select *
      into v_reservation
    from public.reservations r
    where r.id = v_link.reservation_id
      and r.studio_id = target_studio_id
    for update;

    if not found or v_reservation.status <> 'reserved' then
      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'reservation_not_reschedulable'
      );
    end if;

    if exists (
      select 1
      from public.reservations r
      where r.session_id = v_new_session_id
        and r.student_id = v_reservation.student_id
        and r.id <> v_reservation.id
        and r.status in ('reserved', 'attended')
    ) then
      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'already_reserved_target_session'
      );
    end if;

    select count(*)
      into v_occupied
    from public.reservations r
    where r.session_id = v_new_session_id
      and r.id <> v_reservation.id
      and r.status in ('reserved', 'attended');

    if v_occupied >= v_new_session.capacity then
      return jsonb_build_object(
        'ok', true,
        'sync_status', 'requires_attention',
        'reason_code', 'session_full'
      );
    end if;

    if v_reservation.acquisition_id is not null then
      select s.timezone
        into v_timezone
      from public.studios s
      where s.id = target_studio_id;

      v_class_date := (
        target_starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
      )::date;

      select exists (
        select 1
        from public.product_acquisitions pa
        join public.product_template_disciplines ptd
          on ptd.product_template_id = pa.product_template_id
         and ptd.studio_id = pa.studio_id
        where pa.id = v_reservation.acquisition_id
          and pa.studio_id = target_studio_id
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
          and ptd.discipline_id = v_new_discipline_id
      ) into v_same_acquisition_valid;

      if not v_same_acquisition_valid
         or greatest(coalesce(v_reservation.credits_held, 1), 1) <> v_new_credit_cost then
        update public.asistian_booking_links
        set service_name = v_service_name,
            starts_at = target_starts_at,
            session_id = v_new_session_id,
            sync_status = 'requires_attention',
            attention_reason = 'commercial_reassignment_required',
            last_event_name = v_event_name,
            last_source_event_id = target_source_event_id,
            updated_at = now()
        where id = v_link.id;

        return jsonb_build_object(
          'ok', true,
          'sync_status', 'requires_attention',
          'reason_code', 'commercial_reassignment_required',
          'session_id', v_new_session_id
        );
      end if;
    end if;

    update public.reservation_resource_assignments
    set released_at = now(),
        release_reason = 'asistian_rescheduled'
    where reservation_id = v_reservation.id
      and released_at is null;

    update public.reservations
    set session_id = v_new_session_id,
        credits_held = v_new_credit_cost,
        updated_at = now()
    where id = v_reservation.id;

    update public.asistian_booking_links
    set session_id = v_new_session_id,
        service_name = v_service_name,
        starts_at = target_starts_at,
        sync_status = 'synchronized',
        attention_reason = null,
        last_event_name = v_event_name,
        last_source_event_id = target_source_event_id,
        updated_at = now()
    where id = v_link.id;

    if v_reservation.acquisition_id is null then
      perform private.sf177_resolve_walkin_commercial_pending_for_student(
        v_reservation.student_id,
        'asistian_reschedule',
        target_source_event_id
      );

      if exists (
        select 1
        from public.reservations r
        where r.id = v_reservation.id
          and r.acquisition_id is not null
      ) then
        update public.reservations
        set commercial_status = 'covered_by_package',
            updated_at = now()
        where id = v_reservation.id;
      else
        update public.reservations
        set commercial_status = 'payment_pending',
            updated_at = now()
        where id = v_reservation.id;
      end if;
    end if;

    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'integration.asistian.booking_rescheduled',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation.id,
      p_deduplication_key => 'integration.asistian.booking_rescheduled:' || target_source_event_id::text,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'asistian_booking_id', v_booking_id,
        'reservation_id', v_reservation.id,
        'session_id', v_new_session_id,
        'service_name', v_service_name,
        'starts_at', target_starts_at
      )
    );

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synchronized',
      'rescheduled', true,
      'reservation_id', v_reservation.id,
      'session_id', v_new_session_id
    );
  end if;

  if v_event_name in ('booking_confirmed', 'booking_updated', 'booking_status_changed') then
    update public.asistian_booking_links
    set sync_status = 'synchronized',
        attention_reason = null,
        last_event_name = v_event_name,
        last_source_event_id = target_source_event_id,
        updated_at = now()
    where id = v_link.id;

    return jsonb_build_object(
      'ok', true,
      'sync_status', 'synchronized',
      'changed', false,
      'booking_status', nullif(v_booking_status, '')
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'sync_status', 'requires_attention',
    'reason_code', 'unsupported_booking_change'
  );
end;
$$;

revoke all on function public.service_apply_asistian_booking_change(
  uuid,uuid,text,text,text,timestamptz,text
)
from public, anon, authenticated;

grant execute on function public.service_apply_asistian_booking_change(
  uuid,uuid,text,text,text,timestamptz,text
)
to service_role;
