create or replace function public.service_link_student_access(target_student_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
begin
  select s.* into v_student
  from public.students s
  where s.id=target_student_id
  for update;

  if not found then raise exception 'student_not_found'; end if;
  if v_student.person_id is null then raise exception 'student_person_missing'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then raise exception 'student_not_active'; end if;
  if v_student.user_id is not null and v_student.user_id <> target_user_id then raise exception 'student_already_linked'; end if;

  if exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id=v_student.studio_id
      and sm.user_id=target_user_id
      and sm.role <> 'student'
  ) then
    raise exception 'account_has_other_studio_role';
  end if;

  insert into public.user_accounts(id,status,must_change_password)
  values(target_user_id,'active',true)
  on conflict(id) do update
    set status='active',
        must_change_password=public.user_accounts.must_change_password,
        updated_at=now();

  insert into public.studio_memberships(studio_id,user_id,role,active,person_id)
  values(v_student.studio_id,target_user_id,'student',true,v_student.person_id)
  on conflict(studio_id,user_id) do update
    set role='student',active=true,person_id=excluded.person_id;

  update public.students
  set user_id=target_user_id,updated_at=now()
  where id=v_student.id;
end;
$$;
