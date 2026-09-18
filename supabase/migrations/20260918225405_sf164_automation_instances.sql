
create type public.automation_instance_status as enum (
  'draft',
  'active',
  'paused',
  'error',
  'archived'
);

insert into public.capabilities(key, description) values
  ('automations.read', 'Consultar automatizaciones configuradas del estudio'),
  ('automations.manage', 'Crear, configurar y gestionar el ciclo de vida de automatizaciones')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities(role, capability_key) values
  ('owner', 'automations.read'),
  ('owner', 'automations.manage'),
  ('admin', 'automations.read'),
  ('admin', 'automations.manage')
on conflict do nothing;

create table public.automation_instances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  catalog_code text not null check (
    catalog_code in (
      'AUT-CAT-01','AUT-CAT-02','AUT-CAT-03','AUT-CAT-04',
      'AUT-CAT-05','AUT-CAT-06','AUT-CAT-07','AUT-CAT-08',
      'AUT-CAT-09','AUT-CAT-10','AUT-CAT-11','AUT-CAT-12',
      'AUT-CAT-13','AUT-CAT-14','AUT-CAT-15','AUT-CAT-16'
    )
  ),
  status public.automation_instance_status not null default 'draft',
  current_version_number integer not null default 1 check (current_version_number >= 1),
  eligible_from timestamptz,
  first_activated_at timestamptz,
  last_activated_at timestamptz,
  paused_at timestamptz,
  archived_at timestamptz,
  error_code text,
  error_message text,
  error_at timestamptz,
  first_executed_at timestamptz,
  last_executed_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_instances_studio_id_unique unique (studio_id, id),
  constraint automation_instances_active_boundary_chk check (
    status <> 'active' or eligible_from is not null
  ),
  constraint automation_instances_archived_at_chk check (
    status <> 'archived' or archived_at is not null
  ),
  constraint automation_instances_error_at_chk check (
    status <> 'error' or error_at is not null
  ),
  constraint automation_instances_execution_order_chk check (
    first_executed_at is null
    or last_executed_at is null
    or last_executed_at >= first_executed_at
  )
);

create unique index automation_instances_single_template_unique
  on public.automation_instances(studio_id, catalog_code)
  where catalog_code not in ('AUT-CAT-04', 'AUT-CAT-13')
    and status <> 'archived';

create index automation_instances_studio_status_idx
  on public.automation_instances(studio_id, status, updated_at desc);
create index automation_instances_catalog_idx
  on public.automation_instances(studio_id, catalog_code, status);

create table public.automation_instance_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  instance_id uuid not null,
  version_number integer not null check (version_number >= 1),
  catalog_version integer not null default 1 check (catalog_version >= 1),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  effective_from timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint automation_instance_versions_instance_tenant_fkey
    foreign key (studio_id, instance_id)
    references public.automation_instances(studio_id, id)
    on delete cascade,
  constraint automation_instance_versions_instance_version_unique
    unique (instance_id, version_number),
  constraint automation_instance_versions_studio_id_unique
    unique (studio_id, id)
);

alter table public.automation_instances
  add constraint automation_instances_current_version_fkey
  foreign key (id, current_version_number)
  references public.automation_instance_versions(instance_id, version_number)
  deferrable initially deferred;

create index automation_instance_versions_studio_instance_idx
  on public.automation_instance_versions(studio_id, instance_id, version_number desc);

create table public.automation_instance_lifecycle (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  instance_id uuid not null,
  operation text not null check (
    operation in (
      'created',
      'configuration_updated',
      'activated',
      'paused',
      'reactivated',
      'error',
      'archived'
    )
  ),
  from_status public.automation_instance_status,
  to_status public.automation_instance_status not null,
  version_number integer not null check (version_number >= 1),
  actor_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint automation_instance_lifecycle_instance_tenant_fkey
    foreign key (studio_id, instance_id)
    references public.automation_instances(studio_id, id)
    on delete cascade
);

create index automation_instance_lifecycle_instance_created_idx
  on public.automation_instance_lifecycle(studio_id, instance_id, created_at);

alter table public.automation_instances enable row level security;
alter table public.automation_instance_versions enable row level security;
alter table public.automation_instance_lifecycle enable row level security;

create policy automation_instances_read
on public.automation_instances
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy automation_instance_versions_read
on public.automation_instance_versions
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy automation_instance_lifecycle_read
on public.automation_instance_lifecycle
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

revoke all on table public.automation_instances from anon, authenticated;
revoke all on table public.automation_instance_versions from anon, authenticated;
revoke all on table public.automation_instance_lifecycle from anon, authenticated;
grant select on table public.automation_instances to authenticated;
grant select on table public.automation_instance_versions to authenticated;
grant select on table public.automation_instance_lifecycle to authenticated;
grant select on table public.automation_instances to service_role;
grant select on table public.automation_instance_versions to service_role;
grant select on table public.automation_instance_lifecycle to service_role;

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
      'AUT-CAT-14','AUT-CAT-15','AUT-CAT-16'
    ) then 'single'
    else null
  end;
$$;

create or replace function private.automation_allowed_config_keys(p_catalog_code text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_catalog_code
    when 'AUT-CAT-04' then array['lead_time','message_template','send_window']::text[]
    when 'AUT-CAT-07' then array['lead_time']::text[]
    when 'AUT-CAT-12' then array['wait_duration']::text[]
    when 'AUT-CAT-13' then array[
      'days_before_expiration',
      'message_template',
      'send_window',
      'optional_filters',
      'allowed_frequency'
    ]::text[]
    when 'AUT-CAT-14' then array['inactivity_days']::text[]
    when 'AUT-CAT-15' then array['elapsed_since_expiration']::text[]
    else array[]::text[]
  end;
$$;

create or replace function private.assert_automation_configuration(
  p_catalog_code text,
  p_configuration jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invalid_key text;
begin
  if private.automation_catalog_mode(p_catalog_code) is null then
    raise exception 'automation_catalog_code_invalid';
  end if;

  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object' then
    raise exception 'automation_configuration_must_be_object';
  end if;

  select k.key
    into v_invalid_key
  from jsonb_object_keys(p_configuration) as k(key)
  where not (
    k.key = any(private.automation_allowed_config_keys(p_catalog_code))
  )
  limit 1;

  if v_invalid_key is not null then
    raise exception 'automation_configuration_key_not_allowed:%', v_invalid_key;
  end if;
end;
$$;

create or replace function private.assert_admin_manageable_automation(
  p_catalog_code text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.automation_catalog_mode(p_catalog_code) = 'system_managed' then
    raise exception 'automation_instance_system_managed';
  end if;
end;
$$;

revoke all on function private.automation_catalog_mode(text) from public, anon, authenticated;
revoke all on function private.automation_allowed_config_keys(text) from public, anon, authenticated;
revoke all on function private.assert_automation_configuration(text,jsonb) from public, anon, authenticated;
revoke all on function private.assert_admin_manageable_automation(text) from public, anon, authenticated;

create or replace function private.reject_automation_history_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'automation_history_immutable';
end;
$$;

revoke all on function private.reject_automation_history_update() from public, anon, authenticated;

create trigger automation_instance_versions_immutable_update
before update on public.automation_instance_versions
for each row execute function private.reject_automation_history_update();

create trigger automation_instance_lifecycle_immutable_update
before update on public.automation_instance_lifecycle
for each row execute function private.reject_automation_history_update();

create or replace function private.create_automation_instance_internal(
  p_studio_id uuid,
  p_catalog_code text,
  p_configuration jsonb,
  p_actor_user_id uuid,
  p_allow_system_managed boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance_id uuid;
  v_mode text;
begin
  v_mode := private.automation_catalog_mode(p_catalog_code);

  if v_mode is null then
    raise exception 'automation_catalog_code_invalid';
  end if;

  if not p_allow_system_managed and v_mode = 'system_managed' then
    raise exception 'automation_instance_system_managed';
  end if;

  perform private.assert_automation_configuration(
    p_catalog_code,
    coalesce(p_configuration, '{}'::jsonb)
  );

  insert into public.automation_instances (
    studio_id,
    catalog_code,
    status,
    current_version_number,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_studio_id,
    p_catalog_code,
    'draft',
    1,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_instance_id;

  insert into public.automation_instance_versions (
    studio_id,
    instance_id,
    version_number,
    catalog_version,
    configuration,
    effective_from,
    created_by_user_id
  ) values (
    p_studio_id,
    v_instance_id,
    1,
    1,
    coalesce(p_configuration, '{}'::jsonb),
    now(),
    p_actor_user_id
  );

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    p_studio_id,
    v_instance_id,
    'created',
    null,
    'draft',
    1,
    p_actor_user_id,
    null
  );

  return v_instance_id;
end;
$$;

revoke all on function private.create_automation_instance_internal(
  uuid,text,jsonb,uuid,boolean
) from public, anon, authenticated;

create or replace function public.admin_create_automation_instance(
  p_studio_id uuid,
  p_catalog_code text,
  p_configuration jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not private.has_capability(p_studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(p_catalog_code);

  return private.create_automation_instance_internal(
    p_studio_id,
    p_catalog_code,
    coalesce(p_configuration, '{}'::jsonb),
    v_actor,
    false
  );
end;
$$;

revoke all on function public.admin_create_automation_instance(uuid,text,jsonb)
  from public, anon;
grant execute on function public.admin_create_automation_instance(uuid,text,jsonb)
  to authenticated;

create or replace function public.system_create_automation_instance(
  p_studio_id uuid,
  p_catalog_code text,
  p_configuration jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.create_automation_instance_internal(
    p_studio_id,
    p_catalog_code,
    coalesce(p_configuration, '{}'::jsonb),
    null,
    true
  );
$$;

revoke all on function public.system_create_automation_instance(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.system_create_automation_instance(uuid,text,jsonb)
  to service_role;

create or replace function public.admin_update_automation_instance_configuration(
  p_instance_id uuid,
  p_configuration jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_actor uuid := (select auth.uid());
  v_next_version integer;
  v_effective_from timestamptz := now();
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_actor is null
     or not private.has_capability(v_instance.studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(v_instance.catalog_code);

  if v_instance.status = 'archived' then
    raise exception 'automation_instance_archived';
  end if;

  perform private.assert_automation_configuration(
    v_instance.catalog_code,
    p_configuration
  );

  v_next_version := v_instance.current_version_number + 1;

  insert into public.automation_instance_versions (
    studio_id,
    instance_id,
    version_number,
    catalog_version,
    configuration,
    effective_from,
    created_by_user_id
  ) values (
    v_instance.studio_id,
    v_instance.id,
    v_next_version,
    1,
    p_configuration,
    v_effective_from,
    v_actor
  );

  update public.automation_instances
  set current_version_number = v_next_version,
      eligible_from = case
        when status = 'active' then v_effective_from
        else eligible_from
      end,
      updated_by_user_id = v_actor,
      updated_at = v_effective_from
  where id = v_instance.id;

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'configuration_updated',
    v_instance.status,
    v_instance.status,
    v_next_version,
    v_actor,
    null
  );

  return v_next_version;
end;
$$;

revoke all on function public.admin_update_automation_instance_configuration(uuid,jsonb)
  from public, anon;
grant execute on function public.admin_update_automation_instance_configuration(uuid,jsonb)
  to authenticated;

create or replace function public.admin_activate_automation_instance(
  p_instance_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_operation text;
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_actor is null
     or not private.has_capability(v_instance.studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(v_instance.catalog_code);

  if v_instance.status = 'archived' then
    raise exception 'automation_instance_archived';
  end if;

  if v_instance.status = 'active' then
    return;
  end if;

  if v_instance.status not in ('draft', 'paused', 'error') then
    raise exception 'automation_instance_transition_invalid';
  end if;

  v_operation := case
    when v_instance.status = 'draft' then 'activated'
    else 'reactivated'
  end;

  update public.automation_instances
  set status = 'active',
      eligible_from = v_now,
      first_activated_at = coalesce(first_activated_at, v_now),
      last_activated_at = v_now,
      paused_at = null,
      error_code = null,
      error_message = null,
      error_at = null,
      updated_by_user_id = v_actor,
      updated_at = v_now
  where id = v_instance.id;

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_instance.studio_id,
    v_instance.id,
    v_operation,
    v_instance.status,
    'active',
    v_instance.current_version_number,
    v_actor,
    'eligible_from reset; no historical backlog'
  );
end;
$$;

revoke all on function public.admin_activate_automation_instance(uuid)
  from public, anon;
grant execute on function public.admin_activate_automation_instance(uuid)
  to authenticated;

create or replace function public.admin_pause_automation_instance(
  p_instance_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_actor is null
     or not private.has_capability(v_instance.studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(v_instance.catalog_code);

  if v_instance.status = 'paused' then
    return;
  end if;

  if v_instance.status not in ('active', 'error') then
    raise exception 'automation_instance_transition_invalid';
  end if;

  update public.automation_instances
  set status = 'paused',
      paused_at = v_now,
      updated_by_user_id = v_actor,
      updated_at = v_now
  where id = v_instance.id;

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'paused',
    v_instance.status,
    'paused',
    v_instance.current_version_number,
    v_actor,
    'events during pause are not replayed'
  );
end;
$$;

revoke all on function public.admin_pause_automation_instance(uuid)
  from public, anon;
grant execute on function public.admin_pause_automation_instance(uuid)
  to authenticated;

create or replace function public.admin_archive_automation_instance(
  p_instance_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_actor is null
     or not private.has_capability(v_instance.studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(v_instance.catalog_code);

  if v_instance.status = 'archived' then
    return;
  end if;

  update public.automation_instances
  set status = 'archived',
      archived_at = v_now,
      eligible_from = null,
      updated_by_user_id = v_actor,
      updated_at = v_now
  where id = v_instance.id;

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'archived',
    v_instance.status,
    'archived',
    v_instance.current_version_number,
    v_actor,
    'history preserved'
  );
end;
$$;

revoke all on function public.admin_archive_automation_instance(uuid)
  from public, anon;
grant execute on function public.admin_archive_automation_instance(uuid)
  to authenticated;

create or replace function public.admin_delete_automation_draft(
  p_instance_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_actor uuid := (select auth.uid());
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_actor is null
     or not private.has_capability(v_instance.studio_id, 'automations.manage') then
    raise exception 'automations_manage_denied';
  end if;

  perform private.assert_admin_manageable_automation(v_instance.catalog_code);

  if v_instance.status <> 'draft'
     or v_instance.first_executed_at is not null then
    raise exception 'automation_instance_delete_forbidden';
  end if;

  delete from public.automation_instances
  where id = v_instance.id;
end;
$$;

revoke all on function public.admin_delete_automation_draft(uuid)
  from public, anon;
grant execute on function public.admin_delete_automation_draft(uuid)
  to authenticated;

create or replace function public.system_set_automation_instance_error(
  p_instance_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_now timestamptz := now();
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if v_instance.status = 'archived' then
    raise exception 'automation_instance_archived';
  end if;

  if trim(coalesce(p_error_code, '')) = ''
     or trim(coalesce(p_error_message, '')) = '' then
    raise exception 'automation_instance_error_details_required';
  end if;

  update public.automation_instances
  set status = 'error',
      eligible_from = null,
      error_code = trim(p_error_code),
      error_message = trim(p_error_message),
      error_at = v_now,
      updated_at = v_now
  where id = v_instance.id;

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'error',
    v_instance.status,
    'error',
    v_instance.current_version_number,
    null,
    trim(p_error_code) || ': ' || trim(p_error_message)
  );
end;
$$;

revoke all on function public.system_set_automation_instance_error(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.system_set_automation_instance_error(uuid,text,text)
  to service_role;

create or replace function public.system_mark_automation_instance_executed(
  p_instance_id uuid,
  p_version_number integer,
  p_executed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_executed_at timestamptz := coalesce(p_executed_at, now());
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id
  for update;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if not exists (
    select 1
    from public.automation_instance_versions v
    where v.instance_id = p_instance_id
      and v.version_number = p_version_number
  ) then
    raise exception 'automation_instance_version_not_found';
  end if;

  update public.automation_instances
  set first_executed_at = coalesce(first_executed_at, v_executed_at),
      last_executed_at = case
        when last_executed_at is null then v_executed_at
        else greatest(last_executed_at, v_executed_at)
      end,
      updated_at = greatest(updated_at, v_executed_at)
  where id = p_instance_id;
end;
$$;

revoke all on function public.system_mark_automation_instance_executed(uuid,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.system_mark_automation_instance_executed(uuid,integer,timestamptz)
  to service_role;
