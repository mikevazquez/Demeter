alter table public.students
  add column if not exists portal_entry_key uuid;

create unique index if not exists students_portal_entry_key_uidx
  on public.students (portal_entry_key)
  where portal_entry_key is not null;

update public.students
set portal_entry_key = gen_random_uuid(),
    updated_at = now()
where user_id is not null
  and portal_entry_key is null;

create or replace function public.student_portal_entry_route(target_entry_key uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_user_id uuid;
  v_must_change_password boolean;
begin
  if target_entry_key is null then
    return 'invalid';
  end if;

  select s.user_id, ua.must_change_password
    into v_student_user_id, v_must_change_password
  from public.students s
  join public.user_accounts ua
    on ua.id = s.user_id
   and ua.status = 'active'
  join public.studio_memberships sm
    on sm.studio_id = s.studio_id
   and sm.user_id = s.user_id
   and sm.role = 'student'
   and sm.active = true
  where s.portal_entry_key = target_entry_key
    and s.active = true
    and s.lifecycle_status = 'active'
  limit 1;

  if not found or v_student_user_id is null then
    return 'invalid';
  end if;

  if v_must_change_password then
    return 'activate';
  end if;

  if (select auth.uid()) = v_student_user_id then
    return 'profile';
  end if;

  return 'login';
end;
$$;

revoke all on function public.student_portal_entry_route(uuid) from public;
grant execute on function public.student_portal_entry_route(uuid) to anon, authenticated;
