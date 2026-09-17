-- F11 · A22 / FL-17: vincular una cuenta Auth a un InstructorProfile sin mezclar identidades.
-- La creación del usuario Auth ocurre en Edge Function con service_role; este RPC sólo puede
-- ejecutarse desde service_role y deja el vínculo operativo tenant-scoped.

create or replace function public.service_link_instructor_access(
  target_instructor_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_instructor public.instructors%rowtype;
begin
  select i.*
    into v_instructor
  from public.instructors i
  where i.id = target_instructor_id
  for update;

  if not found then raise exception 'instructor_not_found'; end if;
  if v_instructor.status <> 'active' then raise exception 'instructor_not_active'; end if;

  if exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = v_instructor.studio_id
      and sm.person_id = v_instructor.person_id
      and sm.role = 'instructor'
      and sm.user_id <> target_user_id
  ) then
    raise exception 'instructor_already_linked';
  end if;

  if exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = v_instructor.studio_id
      and sm.user_id = target_user_id
      and sm.role <> 'instructor'
  ) then
    raise exception 'account_has_other_studio_role';
  end if;

  insert into public.user_accounts (id, status, must_change_password)
  values (target_user_id, 'active', true)
  on conflict (id) do update
    set status = 'active',
        must_change_password = true,
        updated_at = now();

  insert into public.studio_memberships (studio_id, user_id, role, active, person_id)
  values (
    v_instructor.studio_id,
    target_user_id,
    'instructor',
    true,
    v_instructor.person_id
  )
  on conflict (studio_id, user_id) do update
    set role = 'instructor',
        active = true,
        person_id = excluded.person_id;
end;
$$;

revoke all on function public.service_link_instructor_access(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_link_instructor_access(uuid, uuid) to service_role;

create or replace function public.instructor_complete_password_activation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  if not exists (
    select 1
    from public.studio_memberships sm
    join public.instructors i
      on i.studio_id = sm.studio_id
     and i.person_id = sm.person_id
     and i.status = 'active'
    where sm.user_id = v_user_id
      and sm.role = 'instructor'
      and sm.active = true
      and private.has_capability(sm.studio_id, 'instructor.portal')
  ) then
    raise exception 'instructor_context_not_found';
  end if;

  update public.user_accounts
  set must_change_password = false,
      updated_at = now()
  where id = v_user_id
    and status = 'active';

  if not found then raise exception 'account_not_active'; end if;
end;
$$;

revoke all on function public.instructor_complete_password_activation() from public, anon;
grant execute on function public.instructor_complete_password_activation() to authenticated;
