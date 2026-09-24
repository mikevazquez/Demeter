-- ASISTIAN-SYNC-01B · Universal student-created event.
-- The event now originates from the canonical students table so every legitimate
-- creation path (admin, walk-in, Asistian inbound, future flows) behaves the same.

create or replace function private.emit_student_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'student.created',
    p_source_entity_type => 'student',
    p_source_entity_id => new.id,
    p_deduplication_key => 'student.created:' || new.id::text,
    p_occurred_at => coalesce(new.created_at, clock_timestamp()),
    p_actor_user_id => (select auth.uid()),
    p_payload => jsonb_build_object(
      'student_id', new.id,
      'person_id', new.person_id,
      'student_type', new.student_type,
      'lifecycle_status', new.lifecycle_status,
      'source', 'student_record_insert',
      'integration_intent', 'contact_upsert'
    )
  );

  return new;
end;
$$;

drop trigger if exists asistian_sync01_emit_student_created on public.students;
create trigger asistian_sync01_emit_student_created
after insert on public.students
for each row
execute function private.emit_student_created_event();

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
  v_email text;
begin
  select m.studio_id into v_studio_id
  from public.studio_memberships m
  where m.user_id = (select auth.uid())
    and m.active = true
    and private.has_capability(m.studio_id, 'students.write')
  limit 1;

  if v_studio_id is null then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;

  select pc.person_id into v_person_id
  from public.person_contacts pc
  where pc.studio_id = v_studio_id
    and pc.kind = 'phone'
    and pc.value = p_phone
  limit 1;

  if v_person_id is not null and exists (
    select 1
    from public.students s
    where s.studio_id = v_studio_id
      and s.person_id = v_person_id
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if exists (
    select 1 from public.students s
    where s.studio_id = v_studio_id
      and s.phone = p_phone
      and s.lifecycle_status <> 'archived'
  ) then
    raise exception 'phone_exists';
  end if;

  if v_person_id is null then
    insert into public.persons(studio_id, first_name, last_name)
    values(v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''))
    returning id into v_person_id;

    insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
    values(v_person_id, v_studio_id, 'phone', p_phone, true);
  else
    update public.persons
    set first_name = trim(p_first_name),
        last_name = nullif(trim(coalesce(p_last_name, '')), ''),
        updated_at = now()
    where id = v_person_id;
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');

  if v_email is not null then
    if exists (
      select 1 from public.person_contacts pc
      where pc.studio_id = v_studio_id
        and pc.kind = 'email'
        and lower(pc.value) = v_email
        and pc.person_id <> v_person_id
    ) then
      raise exception 'email_exists';
    end if;

    update public.person_contacts
    set value = v_email,
        is_primary = true,
        updated_at = now()
    where person_id = v_person_id and kind = 'email';

    if not found then
      insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
      values(v_person_id, v_studio_id, 'email', v_email, true);
    end if;
  else
    select pc.value into v_email
    from public.person_contacts pc
    where pc.person_id = v_person_id and pc.kind = 'email'
    order by pc.is_primary desc, pc.created_at asc
    limit 1;
  end if;

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
      then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students(
    studio_id, person_id, full_name, phone, email, active, lifecycle_status, profile_status
  ) values (
    v_studio_id,
    v_person_id,
    v_full_name,
    p_phone,
    v_email,
    true,
    'active',
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null and v_email is not null
      then 'complete'::public.profile_completeness_status
      else 'incomplete'::public.profile_completeness_status
    end
  )
  returning id into v_student_id;

  return v_student_id;
end;
$$;

revoke all on function public.admin_create_student(text,text,text,text)
from public, anon;
grant execute on function public.admin_create_student(text,text,text,text)
to authenticated;

drop function if exists private.request_student_contact_sync(uuid);
