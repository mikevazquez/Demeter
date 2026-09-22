create or replace function public.admin_save_space_resource_map(
  p_space_id uuid,
  p_canvas_width integer,
  p_canvas_height integer,
  p_elements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space public.spaces%rowtype;
  v_revision integer;
  v_element jsonb;
  v_kind text;
  v_resource_id uuid;
  v_element_id uuid;
  v_label text;
  v_x numeric;
  v_y numeric;
  v_width numeric;
  v_height numeric;
  v_rotation numeric;
  v_z_index integer;
  v_metadata jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_space
  from public.spaces
  where id = p_space_id
  for update;

  if not found then
    raise exception 'space_not_found';
  end if;

  if not private.has_capability(v_space.studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if p_canvas_width < 240 or p_canvas_width > 4000
    or p_canvas_height < 240 or p_canvas_height > 4000 then
    raise exception 'invalid_canvas_size';
  end if;

  if p_elements is null or jsonb_typeof(p_elements) <> 'array' then
    raise exception 'invalid_map_elements';
  end if;

  if jsonb_array_length(p_elements) > 250 then
    raise exception 'too_many_map_elements';
  end if;

  insert into public.space_maps (
    space_id,
    studio_id,
    canvas_width,
    canvas_height,
    revision
  )
  values (
    v_space.id,
    v_space.studio_id,
    p_canvas_width,
    p_canvas_height,
    1
  )
  on conflict (space_id)
  do update set
    canvas_width = excluded.canvas_width,
    canvas_height = excluded.canvas_height,
    revision = public.space_maps.revision + 1,
    updated_at = now()
  returning revision into v_revision;

  delete from public.space_map_elements
  where space_id = v_space.id;

  for v_element in
    select value
    from jsonb_array_elements(p_elements)
  loop
    v_kind := btrim(coalesce(v_element->>'element_kind', ''));
    if v_kind not in ('resource', 'door', 'mirror', 'window', 'label') then
      raise exception 'invalid_map_element_kind';
    end if;

    v_resource_id := case
      when nullif(v_element->>'resource_id', '') is null then null
      else (v_element->>'resource_id')::uuid
    end;

    if v_kind = 'resource' and v_resource_id is null then
      raise exception 'resource_element_requires_resource';
    end if;

    if v_kind <> 'resource' and v_resource_id is not null then
      raise exception 'reference_element_cannot_bind_resource';
    end if;

    v_element_id := case
      when nullif(v_element->>'id', '') is null then gen_random_uuid()
      else (v_element->>'id')::uuid
    end;
    v_label := nullif(btrim(coalesce(v_element->>'label', '')), '');
    v_x := coalesce((v_element->>'x')::numeric, 0);
    v_y := coalesce((v_element->>'y')::numeric, 0);
    v_width := coalesce((v_element->>'width')::numeric, 0.08);
    v_height := coalesce((v_element->>'height')::numeric, 0.08);
    v_rotation := mod(coalesce((v_element->>'rotation_degrees')::numeric, 0), 360);
    if v_rotation < 0 then
      v_rotation := v_rotation + 360;
    end if;
    v_z_index := coalesce((v_element->>'z_index')::integer, 0);
    v_metadata := case
      when jsonb_typeof(v_element->'metadata') = 'object' then v_element->'metadata'
      else '{}'::jsonb
    end;

    insert into public.space_map_elements (
      id,
      studio_id,
      space_id,
      resource_id,
      element_kind,
      label,
      x,
      y,
      width,
      height,
      rotation_degrees,
      z_index,
      metadata
    )
    values (
      v_element_id,
      v_space.studio_id,
      v_space.id,
      v_resource_id,
      v_kind,
      v_label,
      v_x,
      v_y,
      v_width,
      v_height,
      v_rotation,
      v_z_index,
      v_metadata
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'space_id', v_space.id,
    'revision', v_revision,
    'element_count', jsonb_array_length(p_elements)
  );
end;
$$;

revoke all on function public.admin_save_space_resource_map(uuid, integer, integer, jsonb)
from public, anon;
grant execute on function public.admin_save_space_resource_map(uuid, integer, integer, jsonb)
to authenticated;

comment on function public.admin_save_space_resource_map(uuid, integer, integer, jsonb) is
  'RECURSOS-01 atomically replaces the canonical resource/reference geometry for one space.';
