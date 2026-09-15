create or replace function public.admin_update_student(
  p_student_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_full_name text;
begin
  select s.studio_id, s.person_id into v_studio_id, v_person_id
  from public.students s
  where s.id = p_student_id
  limit 1;

  if v_studio_id is null or v_person_id is null or not private.has_capability(v_studio_id, 'students.write') then
    raise exception 'students_write_denied';
  end if;

  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  if exists (
    select 1 from public.person_contacts
    where studio_id = v_studio_id and kind = 'phone' and value = p_phone and person_id <> v_person_id
  ) then raise exception 'phone_exists'; end if;

  update public.persons
  set first_name = trim(p_first_name),
      last_name = nullif(trim(coalesce(p_last_name, '')), ''),
      updated_at = now()
  where id = v_person_id;

  update public.person_contacts
  set value = p_phone, is_primary = true, updated_at = now()
  where person_id = v_person_id and kind = 'phone';

  if not found then
    insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
    values(v_person_id, v_studio_id, 'phone', p_phone, true);
  end if;

  if nullif(trim(coalesce(p_email, '')), '') is null then
    delete from public.person_contacts where person_id = v_person_id and kind = 'email';
  else
    update public.person_contacts
    set value = lower(trim(p_email)), is_primary = true, updated_at = now()
    where person_id = v_person_id and kind = 'email';
    if not found then
      insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
      values(v_person_id, v_studio_id, 'email', lower(trim(p_email)), true);
    end if;
  end if;

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null then ' ' || trim(p_last_name)
      else ''
    end
  );

  update public.students
  set full_name = v_full_name,
      phone = p_phone,
      email = nullif(lower(trim(coalesce(p_email, ''))), ''),
      profile_status = case
        when nullif(trim(coalesce(p_last_name, '')), '') is not null
          and nullif(trim(coalesce(p_email, '')), '') is not null
        then 'complete'::public.profile_completeness_status
        else 'incomplete'::public.profile_completeness_status
      end,
      updated_at = now()
  where id = p_student_id;
end;
$$;

create or replace function public.admin_set_student_lifecycle(
  p_student_id uuid,
  p_status public.student_lifecycle_status
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
begin
  select studio_id into v_studio_id from public.students where id = p_student_id limit 1;
  if v_studio_id is null or not private.has_capability(v_studio_id, 'students.archive') then
    raise exception 'students_archive_denied';
  end if;

  update public.students
  set lifecycle_status = p_status,
      active = (p_status = 'active'),
      archived_at = case when p_status = 'archived' then now() else null end,
      archived_by = case when p_status = 'archived' then (select auth.uid()) else null end,
      updated_at = now()
  where id = p_student_id;
end;
$$;

revoke all on function public.admin_update_student(uuid,text,text,text,text) from public;
revoke all on function public.admin_set_student_lifecycle(uuid,public.student_lifecycle_status) from public;
grant execute on function public.admin_update_student(uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_set_student_lifecycle(uuid,public.student_lifecycle_status) to authenticated;
