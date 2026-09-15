create or replace function private.student_profile_status(p_student_id uuid)
returns public.profile_completeness_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.students s
      join public.persons p on p.id = s.person_id
      join public.profile_field_definitions d
        on d.studio_id = s.studio_id
       and d.entity_type = 'student'
       and d.active = true
       and d.required = true
      where s.id = p_student_id
        and (
          (d.key = 'first_name' and trim(coalesce(p.first_name, '')) = '')
          or (d.key = 'last_name' and trim(coalesce(p.last_name, '')) = '')
          or (d.key = 'phone' and not exists (
            select 1 from public.person_contacts c
            where c.person_id = p.id and c.kind = 'phone' and trim(c.value) <> ''
          ))
          or (d.key = 'email' and not exists (
            select 1 from public.person_contacts c
            where c.person_id = p.id and c.kind = 'email' and trim(c.value) <> ''
          ))
          or (
            d.key not in ('first_name','last_name','phone','email')
            and not exists (
              select 1
              from public.profile_field_values v
              where v.definition_id = d.id
                and v.person_id = p.id
                and v.value <> 'null'::jsonb
                and not (jsonb_typeof(v.value) = 'string' and trim(v.value #>> '{}') = '')
                and not (jsonb_typeof(v.value) = 'array' and jsonb_array_length(v.value) = 0)
            )
          )
        )
    ) then 'incomplete'::public.profile_completeness_status
    else 'complete'::public.profile_completeness_status
  end;
$$;

revoke all on function private.student_profile_status(uuid) from public;
grant execute on function private.student_profile_status(uuid) to authenticated;

create or replace function private.refresh_student_profile_status(p_student_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.students
  set profile_status = private.student_profile_status(p_student_id),
      updated_at = now()
  where id = p_student_id;
$$;

revoke all on function private.refresh_student_profile_status(uuid) from public;

create or replace function private.refresh_student_from_profile_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id uuid := coalesce(new.person_id, old.person_id);
  v_student_id uuid;
begin
  select id into v_student_id from public.students where person_id = v_person_id limit 1;
  if v_student_id is not null then
    perform private.refresh_student_profile_status(v_student_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger refresh_student_profile_after_value
  after insert or update or delete on public.profile_field_values
  for each row execute function private.refresh_student_from_profile_value();

create or replace function private.refresh_students_from_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid := coalesce(new.studio_id, old.studio_id);
  v_student record;
begin
  for v_student in select id from public.students where studio_id = v_studio_id loop
    perform private.refresh_student_profile_status(v_student.id);
  end loop;
  return coalesce(new, old);
end;
$$;

create trigger refresh_students_profile_after_definition
  after insert or update or delete on public.profile_field_definitions
  for each row execute function private.refresh_students_from_definition();

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

  perform private.refresh_student_profile_status(v_student_id);
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

  perform private.refresh_student_profile_status(p_student_id);
end;
$$;
