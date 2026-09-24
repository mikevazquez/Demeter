-- ASISTIAN-SYNC-01 · Sync every newly created Demeter CRM contact to Asistian.
-- The canonical business event is contact.created, regardless of whether the person
-- first appears as a student, trial, guest, walk-in, reservation-created contact, or CRM contact.
-- Contact sync remains separate from student_welcome, which owns portal activation messaging.

drop trigger if exists asistian_sync01_emit_student_created on public.students;
drop function if exists private.emit_student_created_domain_event();
drop function if exists private.request_student_contact_sync(uuid);

create or replace function private.emit_contact_created_from_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_entity_type text;
  v_source_entity_id uuid;
  v_deduplication_key text;
begin
  if new.person_id is not null then
    v_source_entity_type := 'person';
    v_source_entity_id := new.person_id;
    v_deduplication_key := 'contact.created:person:' || new.person_id::text;
  else
    v_source_entity_type := 'student';
    v_source_entity_id := new.id;
    v_deduplication_key := 'contact.created:student:' || new.id::text;
  end if;

  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'contact.created',
    p_source_entity_type => v_source_entity_type,
    p_source_entity_id => v_source_entity_id,
    p_deduplication_key => v_deduplication_key,
    p_occurred_at => coalesce(new.created_at, clock_timestamp()),
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', new.id,
      'person_id', new.person_id,
      'source', 'students.insert',
      'integration_intent', 'contact_upsert'
    )
  );

  return new;
end;
$$;

revoke all on function private.emit_contact_created_from_student()
from public, anon, authenticated, service_role;

drop trigger if exists asistian_sync01_emit_contact_from_student on public.students;
create trigger asistian_sync01_emit_contact_from_student
after insert on public.students
for each row
execute function private.emit_contact_created_from_student();

create or replace function private.emit_contact_created_from_crm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'contact.created',
    p_source_entity_type => 'person',
    p_source_entity_id => new.person_id,
    p_deduplication_key => 'contact.created:person:' || new.person_id::text,
    p_occurred_at => coalesce(new.created_at, clock_timestamp()),
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'crm_contact_id', new.id,
      'person_id', new.person_id,
      'source', 'crm_contacts.insert',
      'integration_intent', 'contact_upsert'
    )
  );

  return new;
end;
$$;

revoke all on function private.emit_contact_created_from_crm()
from public, anon, authenticated, service_role;

drop trigger if exists asistian_sync01_emit_contact_from_crm on public.crm_contacts;
create trigger asistian_sync01_emit_contact_from_crm
after insert on public.crm_contacts
for each row
execute function private.emit_contact_created_from_crm();

create or replace function public.admin_set_asistian_webhook_credentials(
  target_studio_id uuid,
  target_template text,
  target_url text,
  target_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_url text := trim(coalesce(target_url, ''));
  v_secret text := trim(coalesce(target_secret, ''));
  v_url_name text;
  v_signing_secret_name text;
  v_vault_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_template not in (
    'contact_upsert',
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    raise exception 'template_not_allowed';
  end if;

  if v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'url_invalid';
  end if;

  if length(v_secret) < 12 then
    raise exception 'secret_invalid';
  end if;

  v_url_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;
  v_signing_secret_name :=
    'asistian_signing_secret:' || target_studio_id::text || ':' || v_template;

  select s.id into v_vault_id
  from vault.secrets s
  where s.name = v_url_name
  limit 1;

  if v_vault_id is null then
    perform vault.create_secret(
      v_url,
      v_url_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  else
    perform vault.update_secret(
      v_vault_id,
      v_url,
      v_url_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  end if;

  v_vault_id := null;

  select s.id into v_vault_id
  from vault.secrets s
  where s.name = v_signing_secret_name
  limit 1;

  if v_vault_id is null then
    perform vault.create_secret(
      v_secret,
      v_signing_secret_name,
      'Studio Flow Asistian incoming webhook signing secret: ' || v_template
    );
  else
    perform vault.update_secret(
      v_vault_id,
      v_secret,
      v_signing_secret_name,
      'Studio Flow Asistian incoming webhook signing secret: ' || v_template
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_webhook_credentials(uuid,text,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_asistian_webhook_credentials(uuid,text,text,text)
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
    'contact_upsert',
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder'
  ) then
    return null;
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret into v_url
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

create or replace function public.service_get_asistian_signing_secret(
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
  v_secret text;
begin
  if v_template not in (
    'contact_upsert',
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    return null;
  end if;

  v_secret_name :=
    'asistian_signing_secret:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_secret;
end;
$$;

revoke all on function public.service_get_asistian_signing_secret(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_get_asistian_signing_secret(uuid,text)
to service_role;

drop trigger if exists asistian_sync01_dispatch_student_created on public.domain_events;
drop function if exists private.dispatch_student_created_event();
drop function if exists private.dispatch_student_created_event_id(uuid);
drop function if exists private.retry_pending_student_created_events();

do $$
begin
  if exists (
    select 1
    from pg_namespace
    where nspname = 'cron'
  ) and exists (
    select 1
    from cron.job
    where jobname = 'asistian-sync01-retry-student-contact'
  ) then
    perform cron.unschedule('asistian-sync01-retry-student-contact');
  end if;
exception
  when others then null;
end $$;

create or replace function private.dispatch_contact_created_event_id(p_event_id uuid)
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
  select s.decrypted_secret into v_project_url
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_project_url'
  limit 1;

  select s.decrypted_secret into v_dispatch_token
  from vault.decrypted_secrets s
  where s.name = 'studio_flow_automation_dispatch_token'
  limit 1;

  if nullif(trim(coalesce(v_project_url, '')), '') is null
     or nullif(trim(coalesce(v_dispatch_token, '')), '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/process-contact-created',
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
    -- External delivery must never roll back the local contact creation.
    return null;
end;
$$;

create or replace function private.dispatch_contact_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_contact_created_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists asistian_sync01_dispatch_contact_created on public.domain_events;
create trigger asistian_sync01_dispatch_contact_created
after insert on public.domain_events
for each row
when (new.event_type = 'contact.created')
execute function private.dispatch_contact_created_event();

create or replace function private.retry_pending_contact_created_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_dispatched integer := 0;
begin
  for v_event in
    select e.event_id
    from public.domain_events e
    where e.event_type = 'contact.created'
      and not exists (
        select 1
        from public.domain_event_consumptions c
        where c.event_id = e.event_id
          and c.consumer_key = 'integration.asistian.contact-upsert'
      )
      and e.occurred_at >= now() - interval '7 days'
    order by e.occurred_at asc
    limit 25
  loop
    if private.dispatch_contact_created_event_id(v_event.event_id) is not null then
      v_dispatched := v_dispatched + 1;
    end if;
  end loop;

  return v_dispatched;
end;
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'asistian-sync01-retry-contact',
      '*/5 * * * *',
      'select private.retry_pending_contact_created_events();'
    );
  end if;
exception
  when others then
    -- Immediate dispatch remains active even if cron scheduling is unavailable.
    null;
end $$;
