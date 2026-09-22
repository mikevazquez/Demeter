create or replace function public.admin_save_session_resources(
  p_session_id uuid,
  p_default_uses integer,
  p_resource_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_item jsonb;
  v_resource_id uuid;
  v_enabled boolean;
  v_capacity_override integer;
  v_saved integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if p_default_uses is null or p_default_uses < 1 or p_default_uses > 20 then
    raise exception 'invalid_resource_uses';
  end if;

  if p_resource_settings is null or jsonb_typeof(p_resource_settings) <> 'array' then
    raise exception 'invalid_resource_settings';
  end if;

  if jsonb_array_length(p_resource_settings) > 250 then
    raise exception 'too_many_resource_settings';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if not v_session.requires_resource then
    raise exception 'session_does_not_require_resource';
  end if;

  if v_session.space_id is null then
    raise exception 'resource_session_requires_space';
  end if;

  update public.class_sessions
  set resource_uses_per_item = p_default_uses
  where id = v_session.id;

  update public.session_resources sr
  set enabled = false,
      capacity_override = null,
      updated_at = now()
  where sr.session_id = v_session.id
    and not exists (
      select 1
      from jsonb_array_elements(p_resource_settings) item
      where nullif(item->>'resource_id', '')::uuid = sr.resource_id
    );

  for v_item in
    select value
    from jsonb_array_elements(p_resource_settings)
  loop
    v_resource_id := nullif(v_item->>'resource_id', '')::uuid;
    v_enabled := coalesce((v_item->>'enabled')::boolean, false);
    v_capacity_override := case
      when nullif(v_item->>'capacity_override', '') is null then null
      else (v_item->>'capacity_override')::integer
    end;

    if v_resource_id is null then
      raise exception 'invalid_resource_id';
    end if;

    if v_capacity_override is not null
      and (v_capacity_override < 1 or v_capacity_override > 20) then
      raise exception 'invalid_resource_capacity';
    end if;

    if not exists (
      select 1
      from public.resources r
      where r.id = v_resource_id
        and r.studio_id = v_session.studio_id
        and r.space_id = v_session.space_id
    ) then
      raise exception 'resource_not_in_session_space';
    end if;

    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_resource_id,
      v_enabled,
      v_capacity_override
    )
    on conflict (session_id, resource_id)
    do update set
      enabled = excluded.enabled,
      capacity_override = excluded.capacity_override,
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'default_uses', p_default_uses,
    'resource_count', v_saved
  );
end;
$$;

revoke all on function public.admin_save_session_resources(uuid, integer, jsonb)
from public, anon;
grant execute on function public.admin_save_session_resources(uuid, integer, jsonb)
to authenticated;

comment on function public.admin_save_session_resources(uuid, integer, jsonb) is
  'RECURSOS-01 atomically saves per-session availability and capacity without changing global resource geometry.';
