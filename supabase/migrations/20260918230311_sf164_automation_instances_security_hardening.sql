
create index automation_instance_lifecycle_actor_user_idx
  on public.automation_instance_lifecycle(actor_user_id)
  where actor_user_id is not null;

create index automation_instance_versions_created_by_user_idx
  on public.automation_instance_versions(created_by_user_id)
  where created_by_user_id is not null;

create index automation_instances_created_by_user_idx
  on public.automation_instances(created_by_user_id)
  where created_by_user_id is not null;

create index automation_instances_updated_by_user_idx
  on public.automation_instances(updated_by_user_id)
  where updated_by_user_id is not null;

create index automation_instances_current_version_idx
  on public.automation_instances(id, current_version_number);

create or replace function private.admin_create_automation_instance_internal(
  p_studio_id uuid,
  p_catalog_code text,
  p_configuration jsonb
)
returns uuid
language plpgsql
security definer
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

revoke all on function private.admin_create_automation_instance_internal(uuid,text,jsonb)
  from public, anon;
grant execute on function private.admin_create_automation_instance_internal(uuid,text,jsonb)
  to authenticated;

create or replace function private.admin_update_automation_instance_configuration_internal(
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

revoke all on function private.admin_update_automation_instance_configuration_internal(uuid,jsonb)
  from public, anon;
grant execute on function private.admin_update_automation_instance_configuration_internal(uuid,jsonb)
  to authenticated;

create or replace function private.transition_automation_instance_internal(
  p_instance_id uuid,
  p_operation text
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
  v_lifecycle_operation text;
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

  case p_operation
    when 'activate' then
      if v_instance.status = 'archived' then
        raise exception 'automation_instance_archived';
      end if;

      if v_instance.status = 'active' then
        return;
      end if;

      if v_instance.status not in ('draft', 'paused', 'error') then
        raise exception 'automation_instance_transition_invalid';
      end if;

      v_lifecycle_operation := case
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
        v_lifecycle_operation,
        v_instance.status,
        'active',
        v_instance.current_version_number,
        v_actor,
        'eligible_from reset; no historical backlog',
        v_now
      );

    when 'pause' then
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

    when 'archive' then
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

    when 'delete_draft' then
      if v_instance.status <> 'draft'
         or v_instance.first_executed_at is not null then
        raise exception 'automation_instance_delete_forbidden';
      end if;

      delete from public.automation_instances
      where id = v_instance.id;

    else
      raise exception 'automation_instance_operation_invalid';
  end case;
end;
$$;

revoke all on function private.transition_automation_instance_internal(uuid,text)
  from public, anon;
grant execute on function private.transition_automation_instance_internal(uuid,text)
  to authenticated;

create or replace function public.admin_create_automation_instance(
  p_studio_id uuid,
  p_catalog_code text,
  p_configuration jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_automation_instance_internal(
    p_studio_id,
    p_catalog_code,
    coalesce(p_configuration, '{}'::jsonb)
  );
$$;

create or replace function public.admin_update_automation_instance_configuration(
  p_instance_id uuid,
  p_configuration jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_update_automation_instance_configuration_internal(
    p_instance_id,
    p_configuration
  );
$$;

create or replace function public.admin_activate_automation_instance(
  p_instance_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_automation_instance_internal(
    p_instance_id,
    'activate'
  );
$$;

create or replace function public.admin_pause_automation_instance(
  p_instance_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_automation_instance_internal(
    p_instance_id,
    'pause'
  );
$$;

create or replace function public.admin_archive_automation_instance(
  p_instance_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_automation_instance_internal(
    p_instance_id,
    'archive'
  );
$$;

create or replace function public.admin_delete_automation_draft(
  p_instance_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_automation_instance_internal(
    p_instance_id,
    'delete_draft'
  );
$$;
