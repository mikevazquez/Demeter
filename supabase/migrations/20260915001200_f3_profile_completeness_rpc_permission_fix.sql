create or replace function public.admin_create_student(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_student_id uuid;
  v_full_name text;
begin
  select m.studio_id into v_studio_id
  from public.studio_memberships m
  where m.user_id = (select auth.uid())
    and m.active = true
    and private.has_capability(m.studio_id, 'students.write')
  limit 1;

  if v_studio_id is null then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  if exists (
    select 1 from public.person_contacts
    where studio_id = v_studio_id and kind = 'phone' and value = p_phone
  ) then raise exception 'phone_exists'; end if;

  insert into public.persons (studio_id, first_name, last_name)
  values (v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
  returning id into v_person_id;

  insert into public.person_contacts (person_id, studio_id, kind, value, is_primary)
  values (v_person_id, v_studio_id, 'phone', p_phone, true);

  if nullif(trim(coalesce(p_email, '')), '') is not null then
    insert into public.person_contacts (person_id, studio_id, kind, value, is_primary)
    values (v_person_id, v_studio_id, 'email', lower(trim(p_email)), true);
  end if;

  v_full_name := trim(p_first_name || case when nullif(trim(coalesce(p_last_name, '')), '') is not null then ' ' || trim(p_last_name) else '' end);

  insert into public.students (
    studio_id, person_id, full_name, phone, email, active, lifecycle_status, profile_status
  ) values (
    v_studio_id, v_person_id, v_full_name, p_phone,
    nullif(lower(trim(coalesce(p_email, ''))), ''), true, 'active', 'incomplete'
  ) returning id into v_student_id;

  update public.students
  set profile_status = private.student_profile_status(v_student_id), updated_at = now()
  where id = v_student_id;

  return v_student_id;
end;
$$;

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
  from public.students s where s.id = p_student_id limit 1;

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

  v_full_name := trim(p_first_name || case when nullif(trim(coalesce(p_last_name, '')), '') is not null then ' ' || trim(p_last_name) else '' end);

  update public.students
  set full_name = v_full_name,
      phone = p_phone,
      email = nullif(lower(trim(coalesce(p_email, ''))), ''),
      updated_at = now()
  where id = p_student_id;

  update public.students
  set profile_status = private.student_profile_status(p_student_id), updated_at = now()
  where id = p_student_id;
end;
$$;
