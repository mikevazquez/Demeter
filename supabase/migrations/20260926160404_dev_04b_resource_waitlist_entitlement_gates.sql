-- DEV-04B: version resource and waitlist entitlement gates already active in Sandbox.

insert into public.role_capabilities(role,capability_key)
values
  ('owner','resources.read'),
  ('owner','resources.manage'),
  ('owner','waitlist.use'),
  ('admin','resources.read'),
  ('admin','resources.manage'),
  ('admin','waitlist.use'),
  ('reception','resources.read'),
  ('instructor','resources.read'),
  ('coach','resources.read'),
  ('student','resources.read'),
  ('student','waitlist.use')
on conflict do nothing;

insert into public.saas_module_capabilities(capability_key,module_key)
values
  ('resources.read','resources'),
  ('resources.manage','resources'),
  ('waitlist.use','waitlist')
on conflict(capability_key) do update
set module_key=excluded.module_key;

CREATE OR REPLACE FUNCTION public.admin_reassign_reservation_resource(p_assignment_id uuid, p_target_resource_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assignment public.reservation_resource_assignments%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_target_setting public.session_resources%rowtype;
  v_target_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_new_assignment_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_assignment
  from public.reservation_resource_assignments
  where id = p_assignment_id
    and released_at is null
  for update;

  if not found then
    raise exception 'assignment_not_found';
  end if;

  if not private.has_capability(v_assignment.studio_id, 'schedule.write')
     or not private.has_capability(v_assignment.studio_id, 'resources.manage') then
    raise exception 'forbidden';
  end if;

  if v_assignment.resource_id = p_target_resource_id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'assignment_id', v_assignment.id,
      'resource_id', v_assignment.resource_id
    );
  end if;

  select *
    into v_reservation
  from public.reservations
  where id = v_assignment.reservation_id
    and studio_id = v_assignment.studio_id
    and session_id = v_assignment.session_id
  for update;

  if not found or v_reservation.status not in ('reserved', 'attended') then
    raise exception 'reservation_not_active';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_assignment.session_id
    and studio_id = v_assignment.studio_id
  for update;

  if not found or not v_session.requires_resource or v_session.space_id is null then
    raise exception 'session_resource_not_available';
  end if;

  select *
    into v_target_setting
  from public.session_resources
  where studio_id = v_assignment.studio_id
    and session_id = v_assignment.session_id
    and resource_id = p_target_resource_id
  for update;

  if not found or not v_target_setting.enabled then
    raise exception 'resource_not_available';
  end if;

  select *
    into v_target_resource
  from public.resources
  where id = p_target_resource_id
    and studio_id = v_assignment.studio_id
    and space_id = v_session.space_id;

  if not found or not v_target_resource.active then
    raise exception 'resource_not_available';
  end if;

  v_capacity := coalesce(
    v_target_setting.capacity_override,
    v_session.resource_uses_per_item,
    1
  );

  select count(*)::integer
    into v_used
  from public.reservation_resource_assignments a
  where a.studio_id = v_assignment.studio_id
    and a.session_id = v_assignment.session_id
    and a.resource_id = p_target_resource_id
    and a.released_at is null
    and a.id <> v_assignment.id;

  if v_used >= v_capacity then
    raise exception 'resource_full';
  end if;

  update public.reservation_resource_assignments
  set released_at = now(),
      release_reason = 'admin_reassigned:' || p_target_resource_id::text
  where id = v_assignment.id
    and released_at is null;

  insert into public.reservation_resource_assignments (
    studio_id,
    session_id,
    reservation_id,
    resource_id,
    assigned_by
  )
  values (
    v_assignment.studio_id,
    v_assignment.session_id,
    v_assignment.reservation_id,
    p_target_resource_id,
    (select auth.uid())
  )
  returning id into v_new_assignment_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'released_assignment_id', v_assignment.id,
    'assignment_id', v_new_assignment_id,
    'reservation_id', v_assignment.reservation_id,
    'from_resource_id', v_assignment.resource_id,
    'resource_id', p_target_resource_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_restore_session_resource_defaults(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_studio_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select studio_id
    into v_studio_id
  from public.class_sessions
  where id = p_session_id;

  if v_studio_id is null then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_studio_id, 'schedule.write')
     or not private.has_capability(v_studio_id, 'resources.manage') then
    raise exception 'forbidden';
  end if;

  perform private.recursos01_apply_template_defaults_to_session(p_session_id, true);

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'customized', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_session_resources(p_session_id uuid, p_default_uses integer, p_resource_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not private.has_capability(v_session.studio_id, 'schedule.write')
     or not private.has_capability(v_session.studio_id, 'resources.manage') then
    raise exception 'forbidden';
  end if;

  if not v_session.requires_resource then
    raise exception 'session_does_not_require_resource';
  end if;

  if v_session.space_id is null then
    raise exception 'resource_session_requires_space';
  end if;

  if exists (
    select 1
    from (
      select a.resource_id, count(*)::integer as used_count
      from public.reservation_resource_assignments a
      where a.session_id = v_session.id
        and a.released_at is null
      group by a.resource_id
    ) assigned
    left join jsonb_array_elements(p_resource_settings) item
      on nullif(item->>'resource_id', '')::uuid = assigned.resource_id
    where item is null
       or coalesce((item->>'enabled')::boolean, false) = false
       or assigned.used_count >
          coalesce(
            nullif(item->>'capacity_override', '')::integer,
            p_default_uses
          )
  ) then
    raise exception 'active_assignments';
  end if;

  update public.class_sessions
  set
    resource_uses_per_item = p_default_uses,
    resource_config_customized = true,
    resource_config_needs_review = false
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
    'resource_count', v_saved,
    'customized', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_space_resource_map(p_space_id uuid, p_canvas_width integer, p_canvas_height integer, p_elements jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select * into v_space
  from public.spaces
  where id = p_space_id
  for update;

  if not found then
    raise exception 'space_not_found';
  end if;

  if not private.has_capability(v_space.studio_id, 'settings.write')
     or not private.has_capability(v_space.studio_id, 'resources.manage') then
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
    space_id, studio_id, canvas_width, canvas_height, revision
  )
  values (
    v_space.id, v_space.studio_id, p_canvas_width, p_canvas_height, 1
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
    select value from jsonb_array_elements(p_elements)
  loop
    v_kind := btrim(coalesce(v_element->>'element_kind', ''));
    if v_kind not in ('resource', 'wall', 'door', 'mirror', 'window', 'label') then
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
      id, studio_id, space_id, resource_id, element_kind, label,
      x, y, width, height, rotation_degrees, z_index, metadata
    )
    values (
      v_element_id, v_space.studio_id, v_space.id, v_resource_id, v_kind, v_label,
      v_x, v_y, v_width, v_height, v_rotation, v_z_index, v_metadata
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'space_id', v_space.id,
    'revision', v_revision,
    'element_count', jsonb_array_length(p_elements)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.coach_session_resource_map(target_studio_id uuid, target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not private.has_capability(target_studio_id, 'resources.read') then
    raise exception 'module_not_enabled';
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
$function$;

CREATE OR REPLACE FUNCTION public.student_book_session_with_resource(target_session_id uuid, target_resource_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_session_resource public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student_id is null then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_session.studio_id, 'resources.read') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_not_enabled');
  end if;

  if v_session.requires_resource then
    if target_resource_id is null then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_required'
      );
    end if;

    select sr.*
      into v_session_resource
    from public.session_resources sr
    where sr.studio_id = v_session.studio_id
      and sr.session_id = v_session.id
      and sr.resource_id = target_resource_id
    for update;

    if not found or not v_session_resource.enabled then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    select *
      into v_resource
    from public.resources r
    where r.id = target_resource_id
      and r.studio_id = v_session.studio_id
      and r.space_id = v_session.space_id;

    if not found or not v_resource.active then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    v_capacity := coalesce(
      v_session_resource.capacity_override,
      v_session.resource_uses_per_item,
      1
    );

    select count(*)::integer
      into v_used
    from public.reservation_resource_assignments a
    where a.studio_id = v_session.studio_id
      and a.session_id = v_session.id
      and a.resource_id = target_resource_id
      and a.released_at is null;

    if v_used >= v_capacity then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_full',
        'resource_id', target_resource_id
      );
    end if;
  end if;

  v_booking := public.book_student(target_session_id, v_student_id);

  if not coalesce((v_booking->>'eligible')::boolean, false) then
    return v_booking;
  end if;

  v_reservation_id := nullif(v_booking->>'reservation_id', '')::uuid;
  if v_reservation_id is null then
    raise exception 'booking_missing_reservation';
  end if;

  if v_session.requires_resource then
    insert into public.reservation_resource_assignments (
      studio_id,
      session_id,
      reservation_id,
      resource_id,
      assigned_by
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_reservation_id,
      target_resource_id,
      (select auth.uid())
    );
  end if;

  return v_booking || jsonb_build_object(
    'resource_id',
    case when v_session.requires_resource then target_resource_id else null end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_book_session_with_reward_credits(target_session_id uuid, target_resource_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_session_resource public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student_id is null then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_session.studio_id, 'resources.read') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_not_enabled');
  end if;

  if v_session.requires_resource then
    if target_resource_id is null then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_required'
      );
    end if;

    select sr.*
      into v_session_resource
    from public.session_resources sr
    where sr.studio_id = v_session.studio_id
      and sr.session_id = v_session.id
      and sr.resource_id = target_resource_id
    for update;

    if not found or not v_session_resource.enabled then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    select *
      into v_resource
    from public.resources r
    where r.id = target_resource_id
      and r.studio_id = v_session.studio_id
      and r.space_id = v_session.space_id;

    if not found or not v_resource.active then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_not_available'
      );
    end if;

    v_capacity := coalesce(
      v_session_resource.capacity_override,
      v_session.resource_uses_per_item,
      1
    );

    select count(*)::integer
      into v_used
    from public.reservation_resource_assignments a
    where a.studio_id = v_session.studio_id
      and a.session_id = v_session.id
      and a.resource_id = target_resource_id
      and a.released_at is null;

    if v_used >= v_capacity then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'resource_full',
        'resource_id', target_resource_id
      );
    end if;
  end if;

  v_booking := public.book_student_with_reward_credits(
    target_session_id,
    v_student_id
  );

  if not coalesce((v_booking->>'eligible')::boolean, false) then
    return v_booking;
  end if;

  v_reservation_id := nullif(v_booking->>'reservation_id', '')::uuid;
  if v_reservation_id is null then
    raise exception 'booking_missing_reservation';
  end if;

  if v_session.requires_resource then
    insert into public.reservation_resource_assignments (
      studio_id,
      session_id,
      reservation_id,
      resource_id,
      assigned_by
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_reservation_id,
      target_resource_id,
      (select auth.uid())
    );
  end if;

  return v_booking || jsonb_build_object(
    'resource_id',
    case when v_session.requires_resource then target_resource_id else null end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_join_waitlist(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_booked integer;
  v_eligibility jsonb;
  v_entry public.class_waitlist_entries%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then raise exception 'session_not_found'; end if;

  select s.* into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'forbidden'; end if;

  if not private.has_capability(v_session.studio_id, 'waitlist.use') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_not_enabled');
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = v_session.id
      and r.student_id = v_student.id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  select * into v_entry
  from public.class_waitlist_entries w
  where w.session_id = v_session.id
    and w.student_id = v_student.id
    and w.status = 'active'
  order by w.joined_at asc
  limit 1;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  perform private.reward_status_sync_student(v_student.id, v_today);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id=m.studio_id
   and d.level_key=m.current_level_key
  where m.studio_id=v_student.studio_id
    and m.student_id=v_student.id;

  if v_entry.id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'waitlist_entry_id', v_entry.id,
      'status', 'active',
      'level_key', v_level.level_key,
      'level_title', v_level.title,
      'medal_key', v_level.level_key,
      'medal_title', v_level.title,
      'waitlist_priority', coalesce(v_level.waitlist_priority,0)
    );
  end if;

  select count(*)::integer into v_booked
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_booked < v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'seat_available');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','waitlist_not_eligible')
    );
  end if;

  insert into public.class_waitlist_entries (
    studio_id, session_id, student_id, status
  )
  values (
    v_student.studio_id, v_session.id, v_student.id, 'active'
  )
  returning * into v_entry;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'waitlist_entry_id', v_entry.id,
    'status', 'active',
    'level_key', v_level.level_key,
    'level_title', v_level.title,
    'medal_key', v_level.level_key,
    'medal_title', v_level.title,
    'waitlist_priority', coalesce(v_level.waitlist_priority,0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_session_resource_map(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_map jsonb;
  v_resources jsonb;
  v_elements jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if v_student_id is null then
    raise exception 'forbidden';
  end if;

  if not private.has_capability(v_session.studio_id, 'resources.read') then
    raise exception 'module_not_enabled';
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
$function$;

CREATE OR REPLACE FUNCTION public.student_waitlist_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  if not private.has_capability(v_student.studio_id, 'waitlist.use') then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(item order by starts_at), '[]'::jsonb)
    into v_result
  from (
    select
      cs.starts_at,
      jsonb_build_object(
        'waitlist_entry_id', w.id,
        'session_id', cs.id,
        'status', w.status,
        'joined_at', w.joined_at,
        'starts_at', cs.starts_at,
        'ends_at', cs.ends_at,
        'activity', ct.name,
        'discipline', d.name,
        'space', sp.name,
        'coach', nullif(trim(concat_ws(' ',ip.first_name,ip.last_name)),'')
      ) as item
    from public.class_waitlist_entries w
    join public.class_sessions cs on cs.id=w.session_id
    join public.class_templates ct on ct.id=cs.template_id
    join public.disciplines d on d.id=ct.discipline_id
    left join public.spaces sp on sp.id=cs.space_id
    left join public.instructors i on i.id=cs.instructor_id
    left join public.persons ip on ip.id=i.person_id
    where w.studio_id=v_student.studio_id
      and w.student_id=v_student.id
      and w.status='active'
      and cs.status='scheduled'
      and cs.starts_at>=now()
  ) q;

  return v_result;
end;
$function$;
