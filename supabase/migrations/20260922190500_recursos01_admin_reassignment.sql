-- RECURSOS-01 · Reasignación administrativa atómica de recurso.
create or replace function public.admin_reassign_reservation_resource(
  p_assignment_id uuid,
  p_target_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if not private.has_capability(v_assignment.studio_id, 'schedule.write') then
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
$$;

revoke execute on function public.admin_reassign_reservation_resource(uuid, uuid)
from public, anon;
grant execute on function public.admin_reassign_reservation_resource(uuid, uuid)
to authenticated;

comment on function public.admin_reassign_reservation_resource(uuid, uuid) is
  'RECURSOS-01 atomically reassigns one active reservation resource while preserving assignment history and capacity guarantees.';
