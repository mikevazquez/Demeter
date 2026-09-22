-- RECURSOS-01 · Coach: mapa canónico de recursos por sesión, solo lectura.
-- Usa la misma geometría global que administración y portal de alumna,
-- respetando el scope del instructor autenticado.

create or replace function public.coach_session_resource_map(
  target_studio_id uuid,
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_instructor_id uuid;
  v_session public.class_sessions%rowtype;
  v_map jsonb;
  v_resources jsonb;
  v_elements jsonb;
begin
  v_instructor_id := private.current_instructor_id(target_studio_id);
  if v_instructor_id is null then
    raise exception 'forbidden';
  end if;

  select *
    into v_session
  from public.class_sessions cs
  where cs.studio_id = target_studio_id
    and cs.id = target_session_id
    and cs.instructor_id = v_instructor_id;

  if not found then
    raise exception 'session_not_available';
  end if;

  if not v_session.requires_resource then
    return jsonb_build_object(
      'session_id', v_session.id,
      'requires_resource', false,
      'default_uses', 1,
      'map', null,
      'resources', '[]'::jsonb,
      'elements', '[]'::jsonb
    );
  end if;

  if v_session.space_id is null then
    return jsonb_build_object(
      'session_id', v_session.id,
      'requires_resource', true,
      'default_uses', v_session.resource_uses_per_item,
      'map', null,
      'resources', '[]'::jsonb,
      'elements', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
      'space_id', sm.space_id,
      'canvas_width', sm.canvas_width,
      'canvas_height', sm.canvas_height,
      'revision', sm.revision
    )
    into v_map
  from public.space_maps sm
  where sm.studio_id = v_session.studio_id
    and sm.space_id = v_session.space_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'resource_id', r.id,
        'name', r.name,
        'short_label', r.short_label,
        'type_name', rt.name,
        'enabled', (sr.enabled and r.active),
        'capacity', coalesce(
          sr.capacity_override,
          v_session.resource_uses_per_item,
          1
        ),
        'used', (
          select count(*)
          from public.reservation_resource_assignments a
          where a.studio_id = v_session.studio_id
            and a.session_id = v_session.id
            and a.resource_id = r.id
            and a.released_at is null
        ),
        'available', greatest(
          coalesce(sr.capacity_override, v_session.resource_uses_per_item, 1)
          - (
            select count(*)
            from public.reservation_resource_assignments a
            where a.studio_id = v_session.studio_id
              and a.session_id = v_session.id
              and a.resource_id = r.id
              and a.released_at is null
          ),
          0
        )
      )
      order by r.name
    ),
    '[]'::jsonb
  )
    into v_resources
  from public.session_resources sr
  join public.resources r
    on r.id = sr.resource_id
   and r.studio_id = sr.studio_id
  join public.resource_types rt
    on rt.id = r.resource_type_id
   and rt.studio_id = r.studio_id
  where sr.studio_id = v_session.studio_id
    and sr.session_id = v_session.id
    and r.space_id = v_session.space_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'resource_id', e.resource_id,
        'element_kind', e.element_kind,
        'label', e.label,
        'x', e.x,
        'y', e.y,
        'width', e.width,
        'height', e.height,
        'rotation_degrees', e.rotation_degrees,
        'z_index', e.z_index
      )
      order by e.z_index, e.created_at
    ),
    '[]'::jsonb
  )
    into v_elements
  from public.space_map_elements e
  where e.studio_id = v_session.studio_id
    and e.space_id = v_session.space_id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'requires_resource', true,
    'default_uses', v_session.resource_uses_per_item,
    'map', v_map,
    'resources', coalesce(v_resources, '[]'::jsonb),
    'elements', coalesce(v_elements, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.coach_session_resource_map(uuid, uuid) from public, anon;
grant execute on function public.coach_session_resource_map(uuid, uuid) to authenticated;

comment on function public.coach_session_resource_map(uuid, uuid) is
  'RECURSOS-01 returns the canonical resource geometry and aggregate availability for a session assigned to the authenticated coach.';
