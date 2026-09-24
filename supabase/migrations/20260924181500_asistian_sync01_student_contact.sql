-- ASISTIAN-SYNC-01 · Sync a newly created Studio Flow student to Asistian as a contact.
-- Contact sync is intentionally separated from student_welcome. The latter remains
-- responsible for the portal activation message once an activation URL exists.

create or replace function private.emit_student_created_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'student.created',
    p_source_entity_type => 'student',
    p_source_entity_id => new.id,
    p_deduplication_key => 'student.created:' || new.id::text,
    p_occurred_at => coalesce(new.created_at, clock_timestamp()),
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', new.id,
      'source', 'students.insert',
      'integration_intent', 'contact_upsert'
    )
  );

  return new;
end;
$$;

revoke all on function private.emit_student_created_domain_event()
from public, anon, authenticated, service_role;

drop trigger if exists asistian_sync01_emit_student_created on public.students;
create trigger asistian_sync01_emit_student_created
after insert on public.students
for each row
execute function private.emit_student_created_domain_event();

create or replace function public.admin_create_student(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_student_id uuid;
  v_full_name text;
  v_email text;
begin
  select m.studio_id into v_studio_id
  from public.studio_memberships m
  where m.user_id = (select auth.uid())
    and m.active = true
    and private.has_capability(m.studio_id, 'students.write')
  limit 1;

  if v_studio_id is null then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  select pc.person_id into v_person_id
  from public.person_contacts pc
  where pc.studio_id = v_studio_id
    and pc.kind = 'phone'
    and pc.value = p_phone
  limit 1;

  if v_person_id is not null and exists (
    select 1
    from public.students s
    where s.studio_id = v_studio_id
      and s.person_id = v_person_id
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if exists (
    select 1 from public.students s
    where s.studio_id = v_studio_id
      and s.phone = p_phone
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if v_person_id is null then
    insert into public.persons(studio_id, first_name, last_name)
    values(v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
    returning id into v_person_id;

    insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
    values(v_person_id, v_studio_id, 'phone', p_phone, true);
  else
    update public.persons
    set first_name = trim(p_first_name),
        last_name = nullif(trim(coalesce(p_last_name, '')), ''),
        updated_at = now()
    where id = v_person_id;
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');

  if v_email is not null then
    if exists (
      select 1 from public.person_contacts pc
      where pc.studio_id = v_studio_id
        and pc.kind = 'email'
        and lower(pc.value) = v_email
        and pc.person_id <> v_person_id
    ) then
      raise exception 'email_exists';
    end if;

    update public.person_contacts
    set value = v_email,
        is_primary = true,
        updated_at = now()
    where person_id = v_person_id and kind = 'email';

    if not found then
      insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
      values(v_person_id, v_studio_id, 'email', v_email, true);
    end if;
  else
    select pc.value into v_email
    from public.person_contacts pc
    where pc.person_id = v_person_id and pc.kind = 'email'
    order by pc.is_primary desc, pc.created_at asc
    limit 1;
  end if;

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
      then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students(
    studio_id, person_id, full_name, phone, email, active, lifecycle_status, profile_status
  ) values (
    v_studio_id,
    v_person_id,
    v_full_name,
    p_phone,
    v_email,
    true,
    'active',
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null and v_email is not null
      then 'complete'::public.profile_completeness_status
      else 'incomplete'::public.profile_completeness_status
    end
  )
  returning id into v_student_id;

  return v_student_id;
end;
$$;

revoke all on function public.admin_create_student(text,text,text,text)
from public, anon;
grant execute on function public.admin_create_student(text,text,text,text)
to authenticated;

drop function if exists private.request_student_contact_sync(uuid);

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
    'student_contact_upsert',
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
    'student_contact_upsert',
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
    'student_contact_upsert',
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

create or replace function private.dispatch_student_created_event_id(p_event_id uuid)
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
    url := rtrim(v_project_url, '/') || '/functions/v1/process-student-created',
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
    -- External delivery must never roll back a committed student creation event.
    return null;
end;
$$;

create or replace function private.dispatch_student_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_student_created_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists asistian_sync01_dispatch_student_created on public.domain_events;
create trigger asistian_sync01_dispatch_student_created
after insert on public.domain_events
for each row
when (new.event_type = 'student.created')
execute function private.dispatch_student_created_event();

create or replace function private.retry_pending_student_created_events()
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
    where e.event_type = 'student.created'
      and not exists (
        select 1
        from public.domain_event_consumptions c
        where c.event_id = e.event_id
          and c.consumer_key = 'integration.asistian.student-contact-upsert'
      )
      and e.occurred_at >= now() - interval '7 days'
    order by e.occurred_at asc
    limit 25
  loop
    if private.dispatch_student_created_event_id(v_event.event_id) is not null then
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
      'asistian-sync01-retry-student-contact',
      '*/5 * * * *',
      'select private.retry_pending_student_created_events();'
    );
  end if;
exception
  when others then
    -- Immediate dispatch remains active even if cron scheduling is unavailable.
    null;
end $$;
