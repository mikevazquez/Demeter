-- SF-174 · Canonical reservation cancellation event and dispatcher.

create or replace function private.emit_booking_cancelled_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'booking.cancelled',
    p_source_entity_type => 'reservation',
    p_source_entity_id => new.id,
    p_deduplication_key => 'booking.cancelled:' || new.id::text,
    p_occurred_at => coalesce(new.cancelled_at, clock_timestamp()),
    p_actor_user_id => new.cancelled_by,
    p_payload => jsonb_build_object(
      'reservation_id', new.id,
      'session_id', new.session_id,
      'student_id', new.student_id,
      'acquisition_id', new.acquisition_id,
      'from_status', old.status::text,
      'to_status', new.status::text,
      'cancelled_at', new.cancelled_at,
      'cancellation_reason', new.cancellation_reason,
      'credits_held', new.credits_held
    )
  );

  return new;
end;
$$;

drop trigger if exists sf174_emit_booking_cancelled on public.reservations;
create trigger sf174_emit_booking_cancelled
after update of status on public.reservations
for each row
when (
  old.status = 'reserved'
  and new.status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio')
  and new.student_id is not null
)
execute function private.emit_booking_cancelled_event();

create or replace function private.dispatch_booking_cancelled_event_id(p_event_id uuid)
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
    url := rtrim(v_project_url, '/') || '/functions/v1/process-booking-cancelled',
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
    -- Delivery infrastructure must never roll back the cancellation transaction.
    return null;
end;
$$;

create or replace function private.dispatch_booking_cancelled_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_booking_cancelled_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists sf174_dispatch_booking_cancelled on public.domain_events;
create trigger sf174_dispatch_booking_cancelled
after insert on public.domain_events
for each row
when (new.event_type = 'booking.cancelled')
execute function private.dispatch_booking_cancelled_event();
