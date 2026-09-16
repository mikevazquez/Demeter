alter table public.user_accounts
  add column if not exists must_change_password boolean not null default false;

create or replace function public.service_link_student_access(
  target_student_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  select s.*
    into v_student
  from public.students s
  where s.id = target_student_id
  for update;

  if not found then
    raise exception 'student_not_found';
  end if;

  if v_student.person_id is null then
    raise exception 'student_person_missing';
  end if;

  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_active';
  end if;

  if v_student.user_id is not null and v_student.user_id <> target_user_id then
    raise exception 'student_already_linked';
  end if;

  if exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = v_student.studio_id
      and sm.user_id = target_user_id
      and sm.role <> 'student'
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
  values (v_student.studio_id, target_user_id, 'student', true, v_student.person_id)
  on conflict (studio_id, user_id) do update
    set role = 'student',
        active = true,
        person_id = excluded.person_id;

  update public.students
  set user_id = target_user_id,
      updated_at = now()
  where id = v_student.id;
end;
$$;

revoke all on function public.service_link_student_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_link_student_access(uuid, uuid) to service_role;

create or replace function public.student_complete_password_activation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1
    from public.students s
    join public.studio_memberships sm
      on sm.studio_id = s.studio_id
     and sm.user_id = v_user_id
     and sm.role = 'student'
     and sm.active = true
    where s.user_id = v_user_id
      and s.active = true
      and s.lifecycle_status = 'active'
      and private.has_capability(s.studio_id, 'student.portal')
  ) then
    raise exception 'student_context_not_found';
  end if;

  update public.user_accounts
  set must_change_password = false,
      updated_at = now()
  where id = v_user_id
    and status = 'active';

  if not found then
    raise exception 'account_not_active';
  end if;
end;
$$;

revoke all on function public.student_complete_password_activation() from public, anon;
grant execute on function public.student_complete_password_activation() to authenticated;
