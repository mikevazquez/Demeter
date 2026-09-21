-- CLASS-REMINDER-01 · Pilot simple: recordatorio 3 horas antes.
-- Alcance deliberadamente mínimo para prueba productiva antes del motor configurable.

create extension if not exists pg_net with schema extensions;

create or replace function public.admin_set_asistian_webhook(
  target_studio_id uuid,
  target_template text,
  target_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_url text := trim(coalesce(target_url, ''));
  v_secret_name text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder'
  ) then
    raise exception 'template_not_allowed';
  end if;

  if v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'url_invalid';
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_webhook(uuid,text,text)
from public, anon, service_role;

grant execute on function public.admin_set_asistian_webhook(uuid,text,text)
to authenticated;

create or replace function public.service_get_asistian_webhook(
  target_studio_id uuid,
  target_template text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_secret_name text;
  v_url text;
begin
  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder'
  ) then
    return null;
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret
    into v_url
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_url;
end;
$$;

revoke all on function public.service_get_asistian_webhook(uuid,text)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_webhook(uuid,text)
to service_role;

create or replace function private.dispatch_class_reminder_event_id(p_event_id uuid)
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
    url := rtrim(v_project_url, '/') || '/functions/v1/process-class-reminder',
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

create or replace function private.dispatch_class_reminder_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_class_reminder_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists sf_class_reminder_dispatch on public.domain_events;
create trigger sf_class_reminder_dispatch
after insert on public.domain_events
for each row
when (new.event_type = 'class.reminder_due')
execute function private.dispatch_class_reminder_event();

create or replace function private.emit_class_reminders_3h_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row record;
  v_event_id uuid;
  v_candidates integer := 0;
begin
  for v_row in
    select
      r.id as reservation_id,
      r.studio_id,
      r.session_id,
      r.student_id,
      cs.starts_at
    from public.reservations r
    join public.class_sessions cs
      on cs.id = r.session_id
     and cs.studio_id = r.studio_id
    join public.students s
      on s.id = r.student_id
     and s.studio_id = r.studio_id
    where r.status = 'reserved'
      and r.student_id is not null
      and cs.status = 'scheduled'
      and s.active = true
      and s.lifecycle_status = 'active'
      and nullif(trim(coalesce(s.phone, '')), '') is not null
      and (cs.starts_at - interval '3 hours') <= v_now
      and (cs.starts_at - interval '3 hours') > v_now - interval '10 minutes'
      and r.booked_at <= cs.starts_at - interval '3 hours'
  loop
    v_event_id := public.emit_domain_event(
      v_row.studio_id,
      'class.reminder_due',
      'reservation',
      v_row.reservation_id,
      'class.reminder.3h:' || v_row.reservation_id::text,
      v_row.starts_at - interval '3 hours',
      null,
      jsonb_build_object(
        'reservation_id', v_row.reservation_id,
        'session_id', v_row.session_id,
        'student_id', v_row.student_id,
        'hours_before', 3,
        'source', 'scheduled_reminder'
      ),
      null,
      null,
      null
    );
    v_candidates := v_candidates + 1;
  end loop;

  for v_row in
    select e.event_id
    from public.domain_events e
    join public.reservations r
      on r.id = e.source_entity_id
    join public.class_sessions cs
      on cs.id = r.session_id
    where e.event_type = 'class.reminder_due'
      and e.source_entity_type = 'reservation'
      and e.recorded_at <= v_now - interval '30 seconds'
      and e.recorded_at > v_now - interval '30 minutes'
      and r.status = 'reserved'
      and cs.status = 'scheduled'
      and cs.starts_at > v_now
      and not exists (
        select 1
        from public.domain_event_consumptions c
        where c.event_id = e.event_id
          and c.consumer_key = 'sf.class_reminder_3h'
      )
  loop
    perform private.dispatch_class_reminder_event_id(v_row.event_id);
  end loop;

  return v_candidates;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'sf_class_reminder_3h'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'sf_class_reminder_3h',
    '* * * * *',
    'select private.emit_class_reminders_3h_due();'
  );
end $$;
