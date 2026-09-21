-- SF-174 · Waitlist promoted communication via Asistian.

alter table public.automation_instances
  drop constraint if exists automation_instances_catalog_code_check;

alter table public.automation_instances
  add constraint automation_instances_catalog_code_check
  check (
    catalog_code = any (array[
      'AUT-CAT-01'::text,'AUT-CAT-02'::text,'AUT-CAT-03'::text,'AUT-CAT-04'::text,
      'AUT-CAT-05'::text,'AUT-CAT-06'::text,'AUT-CAT-07'::text,'AUT-CAT-08'::text,
      'AUT-CAT-09'::text,'AUT-CAT-10'::text,'AUT-CAT-11'::text,'AUT-CAT-12'::text,
      'AUT-CAT-13'::text,'AUT-CAT-14'::text,'AUT-CAT-15'::text,'AUT-CAT-16'::text,
      'AUT-CAT-17'::text
    ])
  );

create or replace function private.automation_catalog_mode(p_catalog_code text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_catalog_code in ('AUT-CAT-04', 'AUT-CAT-13') then 'multiple'
    when p_catalog_code in ('AUT-CAT-08', 'AUT-CAT-09', 'AUT-CAT-10') then 'system_managed'
    when p_catalog_code in (
      'AUT-CAT-01','AUT-CAT-02','AUT-CAT-03','AUT-CAT-05',
      'AUT-CAT-06','AUT-CAT-07','AUT-CAT-11','AUT-CAT-12',
      'AUT-CAT-14','AUT-CAT-15','AUT-CAT-16','AUT-CAT-17'
    ) then 'single'
    else null
  end;
$$;

do $$
declare
  v_studio record;
  v_instance_id uuid;
  v_now timestamptz;
  v_source_url text;
  v_secret_name text;
  v_secret_id uuid;
begin
  for v_studio in select id from public.studios loop
    select id
      into v_instance_id
    from public.automation_instances
    where studio_id = v_studio.id
      and catalog_code = 'AUT-CAT-17'
      and status <> 'archived'
    limit 1;

    if v_instance_id is null then
      v_instance_id := private.create_automation_instance_internal(
        v_studio.id,
        'AUT-CAT-17',
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
        'SF-174 waitlist_promoted enabled; no historical backlog'
      );
    end if;

    select decrypted_secret
      into v_source_url
    from vault.decrypted_secrets
    where name = 'asistian_webhook:' || v_studio.id::text || ':reservation_confirmed'
    limit 1;

    if nullif(trim(coalesce(v_source_url, '')), '') is not null then
      v_secret_name := 'asistian_webhook:' || v_studio.id::text || ':waitlist_promoted';

      select id
        into v_secret_id
      from vault.secrets
      where name = v_secret_name
      limit 1;

      if v_secret_id is null then
        perform vault.create_secret(
          v_source_url,
          v_secret_name,
          'Studio Flow Asistian incoming webhook: waitlist_promoted'
        );
      else
        perform vault.update_secret(
          v_secret_id,
          v_source_url,
          v_secret_name,
          'Studio Flow Asistian incoming webhook: waitlist_promoted'
        );
      end if;
    end if;
  end loop;
end $$;

create or replace function private.dispatch_waitlist_promoted_event_id(p_event_id uuid)
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
    url := rtrim(v_project_url, '/') || '/functions/v1/process-waitlist-promoted',
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

create or replace function private.dispatch_waitlist_promoted_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dispatch_waitlist_promoted_event_id(new.event_id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists sf174_dispatch_waitlist_promoted on public.domain_events;
create trigger sf174_dispatch_waitlist_promoted
after insert on public.domain_events
for each row
when (
  new.event_type = 'booking.created'
  and coalesce(new.payload->>'source', '') = 'waitlist'
)
execute function private.dispatch_waitlist_promoted_event();
