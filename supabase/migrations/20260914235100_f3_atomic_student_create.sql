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

  if v_studio_id is null then
    raise exception 'students_write_denied';
  end if;

  if trim(coalesce(p_first_name, '')) = '' then
    raise exception 'first_name_required';
  end if;

  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone_invalid';
  end if;

  if exists (
    select 1 from public.person_contacts
    where studio_id = v_studio_id and kind = 'phone' and value = p_phone
  ) then
    raise exception 'phone_exists';
  end if;

  insert into public.persons (studio_id, first_name, last_name)
  values (v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
  returning id into v_person_id;

  insert into public.person_contacts (person_id, studio_id, kind, value, is_primary)
  values (v_person_id, v_studio_id, 'phone', p_phone, true);

  if nullif(trim(coalesce(p_email, '')), '') is not null then
    insert into public.person_contacts (person_id, studio_id, kind, value, is_primary)
    values (v_person_id, v_studio_id, 'email', lower(trim(p_email)), true);
  end if;

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students (
    studio_id,
    person_id,
    full_name,
    phone,
    email,
    active,
    lifecycle_status,
    profile_status
  ) values (
    v_studio_id,
    v_person_id,
    v_full_name,
    p_phone,
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    true,
    'active',
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
        and nullif(trim(coalesce(p_email, '')), '') is not null
      then 'complete'::public.profile_completeness_status
      else 'incomplete'::public.profile_completeness_status
    end
  ) returning id into v_student_id;

  return v_student_id;
end;
$$;

revoke all on function public.admin_create_student(text,text,text,text) from public;
grant execute on function public.admin_create_student(text,text,text,text) to authenticated;
