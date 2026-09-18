
alter table public.automation_instance_versions
  alter column effective_from set default clock_timestamp(),
  alter column created_at set default clock_timestamp();

alter table public.automation_instance_lifecycle
  alter column created_at set default clock_timestamp();

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
  v_now timestamptz := clock_timestamp();
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
    updated_by_user_id,
    created_at,
    updated_at
  ) values (
    p_studio_id,
    p_catalog_code,
    'draft',
    1,
    p_actor_user_id,
    p_actor_user_id,
    v_now,
    v_now
  )
  returning id into v_instance_id;

  insert into public.automation_instance_versions (
    studio_id,
    instance_id,
    version_number,
    catalog_version,
    configuration,
    effective_from,
    created_by_user_id,
    created_at
  ) values (
    p_studio_id,
    v_instance_id,
    1,
    1,
    coalesce(p_configuration, '{}'::jsonb),
    v_now,
    p_actor_user_id,
    v_now
  );

  insert into public.automation_instance_lifecycle (
    studio_id,
    instance_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note,
    created_at
  ) values (
    p_studio_id,
    v_instance_id,
    'created',
    null,
    'draft',
    1,
    p_actor_user_id,
    null,
    v_now
  );

  return v_instance_id;
end;
$$;

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
  v_effective_from timestamptz := clock_timestamp();
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
    created_by_user_id,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    v_next_version,
    1,
    p_configuration,
    v_effective_from,
    v_actor,
    v_effective_from
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
    note,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'configuration_updated',
    v_instance.status,
    v_instance.status,
    v_next_version,
    v_actor,
    null,
    v_effective_from
  );

  return v_next_version;
end;
$$;

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
  v_now timestamptz := clock_timestamp();
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
    note,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    v_operation,
    v_instance.status,
    'active',
    v_instance.current_version_number,
    v_actor,
    'eligible_from reset; no historical backlog',
    v_now
  );
end;
$$;

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
  v_now timestamptz := clock_timestamp();
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
    note,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'paused',
    v_instance.status,
    'paused',
    v_instance.current_version_number,
    v_actor,
    'events during pause are not replayed',
    v_now
  );
end;
$$;

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
  v_now timestamptz := clock_timestamp();
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
    note,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'archived',
    v_instance.status,
    'archived',
    v_instance.current_version_number,
    v_actor,
    'history preserved',
    v_now
  );
end;
$$;

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
  v_now timestamptz := clock_timestamp();
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
    note,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    'error',
    v_instance.status,
    'error',
    v_instance.current_version_number,
    null,
    trim(p_error_code) || ': ' || trim(p_error_message),
    v_now
  );
end;
$$;

create or replace function public.system_mark_automation_instance_executed(
  p_instance_id uuid,
  p_version_number integer,
  p_executed_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_executed_at timestamptz := coalesce(p_executed_at, clock_timestamp());
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
