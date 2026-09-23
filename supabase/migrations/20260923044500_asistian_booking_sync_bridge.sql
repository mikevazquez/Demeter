-- ASISTIAN -> STUDIO FLOW · temporary booking synchronization bridge.
-- Idempotently maps a real Asistian booking to an existing Studio Flow session.

create table if not exists public.asistian_booking_links (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  asistian_booking_id text not null,
  asistian_client_id text,
  student_id uuid not null references public.students(id) on delete restrict,
  session_id uuid not null references public.class_sessions(id) on delete restrict,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  service_name text not null,
  starts_at timestamptz not null,
  source_event_id uuid references public.asistian_webhook_events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint asistian_booking_links_booking_required
    check (length(trim(asistian_booking_id)) > 0),
  constraint asistian_booking_links_service_required
    check (length(trim(service_name)) > 0),
  constraint asistian_booking_links_studio_booking_unique
    unique (studio_id, asistian_booking_id),
  constraint asistian_booking_links_reservation_unique
    unique (reservation_id)
);

create index if not exists asistian_booking_links_studio_created_idx
  on public.asistian_booking_links(studio_id, created_at desc);

alter table public.asistian_booking_links enable row level security;

revoke all on table public.asistian_booking_links from public, anon;
grant select on table public.asistian_booking_links to authenticated;
grant select, insert, update on table public.asistian_booking_links to service_role;

drop policy if exists asistian_booking_links_admin_select
  on public.asistian_booking_links;

create policy asistian_booking_links_admin_select
on public.asistian_booking_links
for select
to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or private.has_capability(studio_id, 'schedule.write')
);

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
  v_session_id uuid;
  v_session public.class_sessions%rowtype;
  v_session_match_count integer := 0;
  v_occupied integer := 0;
  v_existing_reservation_id uuid;
  v_reservation_id uuid;
  v_created_student boolean := false;
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
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'created_student', false,
      'student_id', v_existing_link.student_id,
      'session_id', v_existing_link.session_id,
      'reservation_id', v_existing_link.reservation_id,
      'asistian_booking_id', v_existing_link.asistian_booking_id
    );
  end if;

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
    limit 1;

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
    limit 1;

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
        profile_status
      )
      values (
        target_studio_id,
        v_person_id,
        trim(v_first_name || case when v_last_name is not null then ' ' || v_last_name else '' end),
        v_phone,
        true,
        'active',
        'incomplete'
      )
      returning id, user_id into v_student_id, v_student_user_id;

      update public.students
      set profile_status = private.student_profile_status(v_student_id),
          updated_at = now()
      where id = v_student_id;

      v_created_student := true;
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
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'session_not_found',
      'student_id', v_student_id
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
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'resource_selection_required',
      'student_id', v_student_id,
      'session_id', v_session_id
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
    insert into public.asistian_booking_links(
      studio_id,
      asistian_booking_id,
      asistian_client_id,
      student_id,
      session_id,
      reservation_id,
      service_name,
      starts_at,
      source_event_id
    )
    values (
      target_studio_id,
      v_booking_id,
      v_client_id,
      v_student_id,
      v_session_id,
      v_existing_reservation_id,
      v_service_name,
      target_starts_at,
      target_source_event_id
    );

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'existing_reservation', true,
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
      'ok', false,
      'reason_code', 'session_full',
      'student_id', v_student_id,
      'session_id', v_session_id
    );
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
    target_studio_id,
    v_session_id,
    v_student_id,
    v_student_user_id,
    null,
    'reserved',
    1
  )
  returning id into v_reservation_id;

  insert into public.asistian_booking_links(
    studio_id,
    asistian_booking_id,
    asistian_client_id,
    student_id,
    session_id,
    reservation_id,
    service_name,
    starts_at,
    source_event_id
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
    target_source_event_id
  );

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'created_student', v_created_student,
    'commercial_pending', true,
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
