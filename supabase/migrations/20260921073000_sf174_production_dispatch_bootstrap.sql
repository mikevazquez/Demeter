-- SF-174 · Production dispatch/bootstrap dependencies.
-- Captures the already-approved Sandbox runtime needed by reservation_confirmed
-- and reservation_cancelled so the Asistian release is reproducible from GitHub.

create or replace function public.verify_automation_dispatch_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets s
    where s.name = 'studio_flow_automation_dispatch_token'
      and s.decrypted_secret = p_token
      and nullif(trim(p_token), '') is not null
  );
$$;

revoke all on function public.verify_automation_dispatch_token(text)
from public, anon, authenticated;

grant execute on function public.verify_automation_dispatch_token(text)
to service_role;

create or replace function public.book_student(target_session_id uuid, target_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
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

  v_eligibility := public.booking_eligibility(target_session_id, target_student_id);

  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return v_eligibility;
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
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

  if not v_unlimited
     and public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'no_credits',
      'credit_cost', v_credit_cost
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
      v_session.studio_id,
      v_acquisition_id,
      'reserve',
      -v_credit_cost,
      v_reservation_id,
      format('%s crédito(s) reservados al confirmar la clase', v_credit_cost),
      (select auth.uid())
    );
  end if;

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
      'unlimited', v_unlimited,
      'source', 'booking'
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
$$;

create or replace function private.dispatch_booking_created_event_id(p_event_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_dispatch_token text;
  v_request_id bigint;
begin
  select s.decrypted_secret
    into v_project_url
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_project_url'
  limit 1;

  select s.decrypted_secret
    into v_dispatch_token
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_automation_dispatch_token'
  limit 1;

  if nullif(trim(coalesce(v_project_url, '')), '') is null
     or nullif(trim(coalesce(v_dispatch_token, '')), '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/process-booking-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-studio-flow-dispatch-token', v_dispatch_token
    ),
    body := jsonb_build_object('eventId', p_event_id),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    return null;
end;
$$;

create or replace function private.dispatch_booking_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_booking_created_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists sf175_dispatch_booking_created on public.domain_events;
create trigger sf175_dispatch_booking_created
after insert on public.domain_events
for each row
when (new.event_type = 'booking.created')
execute function private.dispatch_booking_created_event();

do $$
declare
  v_studio record;
  v_catalog_code text;
  v_instance_id uuid;
  v_now timestamptz;
begin
  for v_studio in select id from public.studios loop
    foreach v_catalog_code in array array['AUT-CAT-01','AUT-CAT-02'] loop
      select id
        into v_instance_id
      from public.automation_instances
      where studio_id = v_studio.id
        and catalog_code = v_catalog_code
        and status <> 'archived'
      limit 1;

      if v_instance_id is null then
        v_instance_id := private.create_automation_instance_internal(
          v_studio.id,
          v_catalog_code,
          '{}'::jsonb,
          null,
          true
        );

        v_now := clock_timestamp();

        update public.automation_instances
        set status = 'active',
            eligible_from = v_now,
            first_activated_at = v_now,
            last_activated_at = v_now,
            updated_at = v_now
        where id = v_instance_id;

        insert into public.automation_instance_lifecycle(
          studio_id,
          instance_id,
          operation,
          from_status,
          to_status,
          version_number,
          actor_user_id,
          note
        ) values (
          v_studio.id,
          v_instance_id,
          'activated',
          'draft',
          'active',
          1,
          null,
          'SF-174 production bootstrap; no historical backlog'
        );
      end if;
    end loop;
  end loop;
end $$;
