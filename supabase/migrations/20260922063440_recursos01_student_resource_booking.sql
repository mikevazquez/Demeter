create or replace function public.student_session_detail(target_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_result jsonb;
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

  select s.*
    into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if not found then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'session_id', cs.id,
    'starts_at', cs.starts_at,
    'ends_at', cs.ends_at,
    'capacity', cs.capacity,
    'spots_available', greatest(
      cs.capacity - (
        select count(*)
        from public.reservations r
        where r.session_id = cs.id
          and r.status in ('reserved', 'attended')
      ),
      0
    ),
    'activity', ct.name,
    'discipline_id', d.id,
    'discipline', d.name,
    'credit_cost', greatest(coalesce(ct.credit_cost, 1), 1),
    'drop_in_price_minor', ct.drop_in_price_minor,
    'space', sp.name,
    'location', sl.name,
    'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
    'description', cs.notes,
    'requires_resource', cs.requires_resource,
    'resource_uses_per_item', cs.resource_uses_per_item,
    'eligibility', public.booking_eligibility(cs.id, v_student.id),
    'reservation_id', (
      select r.id
      from public.reservations r
      where r.session_id = cs.id
        and r.student_id = v_student.id
        and r.status in ('reserved', 'attended')
      order by r.booked_at desc
      limit 1
    )
  )
    into v_result
  from public.class_sessions cs
  join public.class_templates ct on ct.id = cs.template_id
  join public.disciplines d on d.id = ct.discipline_id
  left join public.spaces sp on sp.id = cs.space_id
  left join public.studio_locations sl on sl.id = cs.location_id
  left join public.instructors i on i.id = cs.instructor_id
  left join public.persons ip on ip.id = i.person_id
  where cs.id = target_session_id;

  return v_result;
end;
$$;

create or replace function public.student_session_resource_map(target_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
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

create or replace function public.student_book_session_with_resource(
  target_session_id uuid,
  target_resource_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.student_session_resource_map(uuid) from public, anon;
grant execute on function public.student_session_resource_map(uuid) to authenticated;

revoke all on function public.student_book_session_with_resource(uuid, uuid) from public, anon;
grant execute on function public.student_book_session_with_resource(uuid, uuid) to authenticated;

comment on function public.student_session_resource_map(uuid) is
  'RECURSOS-01 returns canonical map geometry and real-time availability for a resource-based session.';
comment on function public.student_book_session_with_resource(uuid, uuid) is
  'RECURSOS-01 books a student and atomically assigns the selected physical resource.';
