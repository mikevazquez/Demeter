-- Scope phone uniqueness to the role, not the person or studio globally.
-- Existing records are retained; no people, students, or coaches are merged.
alter table public.person_contacts
  add column if not exists phone_role text not null default 'student';
alter table public.person_contacts
  drop constraint if exists person_contacts_phone_role_check;
alter table public.person_contacts
  add constraint person_contacts_phone_role_check
  check (phone_role in ('student','coach'));

-- Existing coach-only contacts are tagged as coach, preserving the same records.
update public.person_contacts pc set phone_role='coach'
where pc.kind='phone'
  and exists (select 1 from public.instructors i
              where i.studio_id=pc.studio_id and i.person_id=pc.person_id)
  and not exists (select 1 from public.students s
                  where s.studio_id=pc.studio_id and s.person_id=pc.person_id);

create or replace function private.phone_identity_key(p_phone text)
returns text language sql immutable strict set search_path='' as $fn$
  select case
    when regexp_replace(p_phone,'[^0-9]','','g') ~ '^[0-9]{10}$'
      then '52'||regexp_replace(p_phone,'[^0-9]','','g')
    when regexp_replace(p_phone,'[^0-9]','','g') ~ '^521[0-9]{10}$'
      then '52'||right(regexp_replace(p_phone,'[^0-9]','','g'),10)
    else regexp_replace(p_phone,'[^0-9]','','g')
  end;
$fn$;

drop index if exists public.person_contacts_unique_value_per_studio;
create unique index if not exists person_contacts_email_unique_per_studio
  on public.person_contacts(studio_id,kind,lower(value))
  where kind='email';
create unique index if not exists person_contacts_phone_unique_per_role
  on public.person_contacts(studio_id,phone_role,private.phone_identity_key(value))
  where kind='phone';

-- The students table is also a source of truth for student phone lookups.
-- Prevent two students with equivalent +52/521/10-digit representations.
create unique index if not exists students_studio_phone_identity_unique
  on public.students(studio_id,private.phone_identity_key(phone))
  where phone is not null;

create policy person_contacts_coach_phone_read
  on public.person_contacts for select to authenticated
  using (kind='phone' and phone_role='coach'
    and private.has_capability(studio_id,'instructors.read')
    and exists (select 1 from public.instructors i
                where i.studio_id=person_contacts.studio_id
                  and i.person_id=person_contacts.person_id));

create policy person_contacts_coach_phone_write
  on public.person_contacts for all to authenticated
  using (kind='phone' and phone_role='coach'
    and private.has_capability(studio_id,'instructors.write')
    and exists (select 1 from public.instructors i
                where i.studio_id=person_contacts.studio_id
                  and i.person_id=person_contacts.person_id))
  with check (kind='phone' and phone_role='coach'
    and private.has_capability(studio_id,'instructors.write')
    and exists (select 1 from public.instructors i
                where i.studio_id=person_contacts.studio_id
                  and i.person_id=person_contacts.person_id));

-- Instructor phone editing uses the coach-only contact, not a student's contact.
create or replace function public.admin_update_instructor_phone(
  p_instructor_id uuid,p_phone text
) returns void language plpgsql set search_path='' as $fn$
declare v_studio_id uuid; v_person_id uuid; v_phone text;
begin
 select studio_id,person_id into v_studio_id,v_person_id
 from public.instructors where id=p_instructor_id;
 if v_studio_id is null or not private.has_capability(v_studio_id,'instructors.write')
   then raise exception 'forbidden' using errcode='42501'; end if;
 v_phone:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
 if v_phone is not null and v_phone !~ '^52[0-9]{10}$'
   then raise exception 'phone_invalid' using errcode='22023'; end if;
 if v_phone is null then
   delete from public.person_contacts where studio_id=v_studio_id
     and person_id=v_person_id and kind='phone' and phone_role='coach';
 elsif exists(select 1 from public.person_contacts where studio_id=v_studio_id
     and person_id=v_person_id and kind='phone' and phone_role='coach') then
   update public.person_contacts set value='+'||v_phone,is_primary=true,updated_at=now()
   where id=(select id from public.person_contacts
     where studio_id=v_studio_id and person_id=v_person_id
       and kind='phone' and phone_role='coach'
     order by is_primary desc,created_at limit 1);
 else
   insert into public.person_contacts(studio_id,person_id,kind,value,is_primary,phone_role)
   values(v_studio_id,v_person_id,'phone','+'||v_phone,true,'coach');
 end if;
end $fn$;

-- Existing secured instructor creation; only the phone role is changed.
-- Explicit tenant selection: an owner can belong to multiple studios.
-- The former admin_create_instructor chose the first membership, regardless
-- of the studio selected in the admin portal.
create or replace function public.admin_create_instructor_scoped(
  p_studio_id uuid,
  p_first_name text,
  p_last_name text default null,
  p_phone text default null,
  p_email text default null,
  p_bio text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_person_id uuid; v_instructor_id uuid;
begin
  if (select auth.uid()) is null
     or p_studio_id is null
     or not private.has_capability(p_studio_id,'instructors.write') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if nullif(trim(p_first_name),'') is null then
    raise exception 'first_name_required' using errcode='22023';
  end if;

  insert into public.persons(studio_id,first_name,last_name)
  values(p_studio_id,trim(p_first_name),nullif(trim(coalesce(p_last_name,'')),''))
  returning id into v_person_id;

  if nullif(trim(coalesce(p_phone,'')),'') is not null then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary,phone_role)
    values(p_studio_id,v_person_id,'phone',trim(p_phone),true,'coach');
  end if;
  if nullif(trim(coalesce(p_email,'')),'') is not null then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary)
    values(p_studio_id,v_person_id,'email',lower(trim(p_email)),true);
  end if;

  insert into public.instructors(studio_id,person_id,bio)
  values(p_studio_id,v_person_id,nullif(trim(coalesce(p_bio,'')),''))
  returning id into v_instructor_id;
  return v_instructor_id;
end;
$$;
revoke all on function public.admin_create_instructor_scoped(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.admin_create_instructor_scoped(uuid,text,text,text,text,text) to authenticated;


-- Preserve student-only identity resolution when the phone is also a coach contact.
CREATE OR REPLACE FUNCTION public.admin_create_student(p_first_name text, p_last_name text, p_phone text, p_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_studio_id uuid; v_person_id uuid; v_student_id uuid; v_full_name text; v_email text;
begin
  select m.studio_id into v_studio_id from public.studio_memberships m
  where m.user_id=(select auth.uid()) and m.active=true and private.has_capability(m.studio_id,'students.write') limit 1;
  if v_studio_id is null then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name,''))='' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^[+][1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;
  select pc.person_id into v_person_id from public.person_contacts pc where pc.studio_id=v_studio_id and pc.kind='phone' and pc.phone_role='student' and pc.value=p_phone limit 1;
  if v_person_id is not null and exists(select 1 from public.students s where s.studio_id=v_studio_id and s.person_id=v_person_id and s.lifecycle_status<>'archived') then raise exception 'phone_exists'; end if;
  if exists(select 1 from public.students s where s.studio_id=v_studio_id and s.phone=p_phone and s.lifecycle_status<>'archived') then raise exception 'phone_exists'; end if;
  if v_person_id is null then
    insert into public.persons(studio_id,first_name,last_name) values(v_studio_id,trim(p_first_name),nullif(trim(coalesce(p_last_name,'')),'')) returning id into v_person_id;
    insert into public.person_contacts(person_id,studio_id,kind,value,is_primary) values(v_person_id,v_studio_id,'phone',p_phone,true);
  else
    update public.persons set first_name=trim(p_first_name),last_name=nullif(trim(coalesce(p_last_name,'')),''),updated_at=now() where id=v_person_id;
  end if;
  v_email:=nullif(lower(trim(coalesce(p_email,''))),'');
  if v_email is not null then
    if exists(select 1 from public.person_contacts pc where pc.studio_id=v_studio_id and pc.kind='email' and lower(pc.value)=v_email and pc.person_id<>v_person_id) then raise exception 'email_exists'; end if;
    update public.person_contacts set value=v_email,is_primary=true,updated_at=now() where person_id=v_person_id and kind='email';
    if not found then insert into public.person_contacts(person_id,studio_id,kind,value,is_primary) values(v_person_id,v_studio_id,'email',v_email,true); end if;
  else
    select pc.value into v_email from public.person_contacts pc where pc.person_id=v_person_id and pc.kind='email' order by pc.is_primary desc,pc.created_at asc limit 1;
  end if;
  v_full_name:=trim(p_first_name||case when nullif(trim(coalesce(p_last_name,'')),'') is not null then ' '||trim(p_last_name) else '' end);
  insert into public.students(studio_id,person_id,full_name,phone,email,active,lifecycle_status,profile_status)
  values(v_studio_id,v_person_id,v_full_name,p_phone,v_email,true,'active',
    case when nullif(trim(coalesce(p_last_name,'')),'') is not null and v_email is not null then 'complete'::public.profile_completeness_status else 'incomplete'::public.profile_completeness_status end)
  returning id into v_student_id;
  return v_student_id;
end;$function$


-- Preserve student-only identity resolution when the phone is also a coach contact.
CREATE OR REPLACE FUNCTION public.admin_update_student(p_student_id uuid, p_first_name text, p_last_name text, p_phone text, p_email text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_studio_id uuid;
  v_person_id uuid;
  v_full_name text;
begin
  select s.studio_id, s.person_id into v_studio_id, v_person_id from public.students s where s.id = p_student_id limit 1;
  if v_studio_id is null or v_person_id is null or not private.has_capability(v_studio_id, 'students.write') then raise exception 'students_write_denied'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;
  if exists (select 1 from public.person_contacts where studio_id = v_studio_id and kind = 'phone' and phone_role = 'student' and value = p_phone and person_id <> v_person_id) then raise exception 'phone_exists'; end if;
  update public.persons set first_name = trim(p_first_name), last_name = nullif(trim(coalesce(p_last_name, '')), ''), updated_at = now() where id = v_person_id;
  update public.person_contacts set value = p_phone, is_primary = true, updated_at = now() where person_id = v_person_id and kind = 'phone' and phone_role='student';
  if not found then insert into public.person_contacts(person_id, studio_id, kind, value, is_primary) values(v_person_id, v_studio_id, 'phone', p_phone, true); end if;
  if nullif(trim(coalesce(p_email, '')), '') is null then delete from public.person_contacts where person_id = v_person_id and kind = 'email';
  else
    update public.person_contacts set value = lower(trim(p_email)), is_primary = true, updated_at = now() where person_id = v_person_id and kind = 'email';
    if not found then insert into public.person_contacts(person_id, studio_id, kind, value, is_primary) values(v_person_id, v_studio_id, 'email', lower(trim(p_email)), true); end if;
  end if;
  v_full_name := trim(p_first_name || case when nullif(trim(coalesce(p_last_name, '')), '') is not null then ' ' || trim(p_last_name) else '' end);
  update public.students set full_name = v_full_name, phone = p_phone, email = nullif(lower(trim(coalesce(p_email, ''))), ''), updated_at = now() where id = p_student_id;
  update public.students set profile_status = private.student_profile_status(p_student_id), updated_at = now() where id = p_student_id;
end;
$function$


-- Preserve student-only identity resolution when the phone is also a coach contact.
CREATE OR REPLACE FUNCTION public.coach_find_walkin_student(target_studio_id uuid, target_session_id uuid, target_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student_id uuid;
  v_student_name text;
  v_already_in_roster boolean;
begin
  if target_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone_invalid';
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id;

  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(target_studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(target_studio_id, target_session_id) then
    raise exception 'forbidden';
  end if;

  select s.id, s.full_name
  into v_student_id, v_student_name
  from public.students s
  join public.person_contacts pc
    on pc.person_id = s.person_id
   and pc.studio_id = s.studio_id
  where s.studio_id = target_studio_id
    and s.active = true
    and s.lifecycle_status = 'active'
    and pc.kind = 'phone' and pc.phone_role='student'
    and pc.value = target_phone
  order by pc.is_primary desc, pc.created_at asc
  limit 1;

  if v_student_id is null then
    return jsonb_build_object('found', false);
  end if;

  select exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = v_student_id
      and r.status in ('reserved', 'attended', 'no_show')
  ) into v_already_in_roster;

  return jsonb_build_object(
    'found', true,
    'student_id', v_student_id,
    'student_name', v_student_name,
    'already_in_roster', v_already_in_roster
  );
end;
$function$


-- Preserve student-only identity resolution when the phone is also a coach contact.
CREATE OR REPLACE FUNCTION public.service_prepare_meta_whatsapp_message(target_studio_id uuid, target_event_id uuid, target_provider_message_id text, target_wa_id text, target_profile_name text, target_message_type text, target_message_text text, target_activity_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_provider_message_id text := trim(coalesce(target_provider_message_id, ''));
  v_wa_id text := regexp_replace(coalesce(target_wa_id, ''), '[^0-9]', '', 'g');
  v_match_digits text;
  v_phone text;
  v_profile_name text := nullif(trim(coalesce(target_profile_name, '')), '');
  v_message_type text := lower(trim(coalesce(target_message_type, '')));
  v_message_text text := trim(coalesce(target_message_text, ''));
  v_activity_at timestamptz := coalesce(target_activity_at, clock_timestamp());
  v_student_id uuid;
  v_student_matches integer := 0;
  v_person_id uuid;
  v_crm_contact_id uuid;
  v_crm_conversation_id uuid;
  v_assistant_conversation_id uuid;
  v_inbound_turn_id uuid;
  v_handoff_open boolean := false;
  v_existing_status text;
  v_name_parts text[];
  v_capture_name text;
  v_full_name text;
  v_assistant_context jsonb;
  v_new_contact boolean := false;
  v_identity_needs_name boolean := false;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null
     or target_event_id is null
     or v_provider_message_id = ''
     or v_wa_id !~ '^[1-9][0-9]{7,14}$'
     or v_message_type = ''
     or v_message_text = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.assistant_whatsapp_events e
    where e.id = target_event_id
      and e.studio_id = target_studio_id
      and e.provider = 'meta_whatsapp'
      and e.provider_event_id = v_provider_message_id
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  -- Meta historically returned 521XXXXXXXXXX for some Mexican numbers.
  -- Canonicalize that legacy representation to 52XXXXXXXXXX.
  v_match_digits :=
    case
      when v_wa_id ~ '^521[0-9]{10}$' then '52' || substring(v_wa_id from 4)
      else v_wa_id
    end;
  v_phone := '+' || v_match_digits;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':meta-whatsapp:' || v_match_digits,
      0
    )
  );

  select count(distinct s.id)
    into v_student_matches
  from public.students s
  where s.studio_id = target_studio_id
    and (
      case
        when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
          then '52' || substring(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4)
        else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
      end = v_match_digits
      or exists (
        select 1
        from public.person_contacts pc
        where pc.studio_id = target_studio_id
          and pc.person_id = s.person_id
          and pc.kind = 'phone' and pc.phone_role='student'
          and (
            case
              when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
                then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
              else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
            end
          ) = v_match_digits
      )
    );

  if v_student_matches = 1 then
    select s.id, s.person_id
      into v_student_id, v_person_id
    from public.students s
    where s.studio_id = target_studio_id
      and (
        case
          when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
        end = v_match_digits
        or exists (
          select 1
          from public.person_contacts pc
          where pc.studio_id = target_studio_id
            and pc.person_id = s.person_id
            and pc.kind = 'phone' and pc.phone_role='student'
            and (
              case
                when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
                  then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
                else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
              end
            ) = v_match_digits
        )
      )
    limit 1;

    if v_person_id is not null then
      select c.id
        into v_crm_contact_id
      from public.crm_contacts c
      where c.studio_id = target_studio_id
        and c.person_id = v_person_id
      order by c.created_at asc
      limit 1;
    end if;
  end if;

  if v_crm_contact_id is null then
    select c.crm_contact_id
      into v_crm_contact_id
    from public.crm_conversations c
    where c.studio_id = target_studio_id
      and c.provider = 'meta_whatsapp'
      and c.contact_phone = v_phone
      and c.crm_contact_id is not null
    order by c.last_activity_at desc
    limit 1;
  end if;

  if v_crm_contact_id is null then
    select c.id, c.person_id
      into v_crm_contact_id, v_person_id
    from public.crm_contacts c
    join public.person_contacts pc
      on pc.studio_id = c.studio_id
     and pc.person_id = c.person_id
     and pc.kind = 'phone' and pc.phone_role='student'
    where c.studio_id = target_studio_id
      and (
        case
          when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
        end
      ) = v_match_digits
    order by c.created_at asc
    limit 1;
  end if;

  if v_crm_contact_id is null then
    select pc.person_id
      into v_person_id
    from public.person_contacts pc
    where pc.studio_id = target_studio_id
      and pc.kind = 'phone' and pc.phone_role='student'
      and (
        case
          when regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g') from 4)
          else regexp_replace(coalesce(pc.value, ''), '[^0-9]', '', 'g')
        end
      ) = v_match_digits
    limit 1;

    if v_person_id is not null then
      insert into public.crm_contacts(studio_id, person_id, lifecycle_status, source)
      values (target_studio_id, v_person_id, 'prospect', 'meta_whatsapp')
      returning id into v_crm_contact_id;
      v_new_contact := true;
    end if;
  end if;

  if v_student_id is null and v_crm_contact_id is null then
    v_name_parts := regexp_split_to_array(
      coalesce(v_profile_name, 'Prospecto'),
      '\\s+'
    );

    insert into public.persons(
      studio_id,
      first_name,
      last_name
    )
    values (
      target_studio_id,
      left(coalesce(nullif(v_name_parts[1], ''), 'Prospecto'), 120),
      nullif(left(
        case
          when array_length(v_name_parts, 1) > 1
            then array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' ')
          else ''
        end,
        180
      ), '')
    )
    returning id into v_person_id;

    insert into public.crm_contacts(
      studio_id,
      person_id,
      lifecycle_status,
      source
    )
    values (
      target_studio_id,
      v_person_id,
      'prospect',
      'meta_whatsapp'
    )
    returning id into v_crm_contact_id;
    insert into public.person_contacts(studio_id, person_id, kind, value, is_primary)
    values (target_studio_id, v_person_id, 'phone', v_phone, true)
    on conflict do nothing;
    v_new_contact := true;
  end if;

  if v_student_id is null and v_crm_contact_id is not null and not v_new_contact then
    select exists (
      select 1
      from public.crm_contacts c
      join public.persons p on p.id = c.person_id and p.studio_id = c.studio_id
      where c.id = v_crm_contact_id
        and c.studio_id = target_studio_id
        and lower(trim(coalesce(p.first_name, ''))) = 'prospecto'
        and nullif(trim(coalesce(p.last_name, '')), '') is null
    ) into v_identity_needs_name;
  end if;

  select c.id
    into v_crm_conversation_id
  from public.crm_conversations c
  where c.studio_id = target_studio_id
    and c.provider = 'meta_whatsapp'
    and c.provider_contact_id = v_wa_id
    and v_activity_at >= c.started_at
    and v_activity_at < c.started_at + interval '24 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_crm_conversation_id is null then
    insert into public.crm_conversations(
      studio_id,
      provider,
      provider_contact_id,
      contact_name,
      contact_phone,
      student_id,
      crm_contact_id,
      channel,
      started_at,
      last_activity_at,
      activity_count,
      source,
      campaign,
      first_source_event_id,
      last_source_event_id,
      metadata
    )
    values (
      target_studio_id,
      'meta_whatsapp',
      v_wa_id,
      v_profile_name,
      v_phone,
      v_student_id,
      v_crm_contact_id,
      'whatsapp',
      v_activity_at,
      v_activity_at,
      1,
      'meta_whatsapp',
      null,
      null,
      null,
      jsonb_build_object(
        'meta_first_event_id', target_event_id,
        'meta_last_event_id', target_event_id
      )
    )
    returning id into v_crm_conversation_id;

    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'conversation.started',
      p_source_entity_type => 'crm_conversation',
      p_source_entity_id => v_crm_conversation_id,
      p_deduplication_key => 'conversation.started:' || v_crm_conversation_id::text,
      p_occurred_at => v_activity_at,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'conversation_id', v_crm_conversation_id,
        'student_id', v_student_id,
        'provider', 'meta_whatsapp',
        'provider_contact_id', v_wa_id,
        'channel', 'whatsapp',
        'source', 'meta_whatsapp'
      )
    );
  else
    update public.crm_conversations
    set contact_name = coalesce(contact_name, v_profile_name),
        contact_phone = coalesce(contact_phone, v_phone),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        activity_count = activity_count + 1,
        metadata = metadata || jsonb_build_object(
          'meta_last_event_id', target_event_id
        ),
        updated_at = clock_timestamp()
    where id = v_crm_conversation_id;
  end if;

  select ac.id, ac.status, ac.context
    into v_assistant_conversation_id, v_existing_status, v_assistant_context
  from public.assistant_conversations ac
  where ac.studio_id = target_studio_id
    and ac.channel = 'whatsapp'
    and ac.external_thread_ref = v_wa_id
  limit 1
  for update;

  if v_assistant_conversation_id is not null then
    v_identity_needs_name := coalesce((v_assistant_context->>'identity_needs_name')::boolean, false);
    if not v_identity_needs_name and v_student_id is null and v_crm_contact_id is not null then
      select exists (
        select 1
        from public.crm_contacts c
        join public.persons p on p.id = c.person_id and p.studio_id = c.studio_id
        where c.id = v_crm_contact_id
          and c.studio_id = target_studio_id
          and lower(trim(coalesce(p.first_name, ''))) = 'prospecto'
          and nullif(trim(coalesce(p.last_name, '')), '') is null
      ) into v_identity_needs_name;
    end if;

    if v_identity_needs_name and v_student_id is null and v_crm_contact_id is not null and not v_new_contact then
      if v_person_id is null then
        select c.person_id into v_person_id
        from public.crm_contacts c
        where c.id = v_crm_contact_id and c.studio_id = target_studio_id;
      end if;
      v_capture_name := trim(regexp_replace(v_message_text, '^(me llamo|mi nombre es|soy)[[:space:]]+', '', 'i'));
      if v_capture_name is not null
         and char_length(v_capture_name) between 2 and 180
         and v_capture_name ~ '^[[:alpha:]][[:alpha:] ''’.-]*$'
         and array_length(regexp_split_to_array(v_capture_name, '[[:space:]]+'), 1) between 1 and 6
         and lower(v_capture_name) !~ '(^|[[:space:]])(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|hoy|mañana|manana|ocho|nueve|diez|once|doce|clase|horario|reservar|reserva|pole|fitness|twerk|yoga|heels|espiral|flexibilidad|aérea|aerea)([[:space:]]|$)'
         and not exists (
           select 1 from public.class_templates ct
           where ct.studio_id = target_studio_id
             and lower(trim(ct.name)) = lower(trim(v_capture_name))
         ) then
        v_name_parts := regexp_split_to_array(trim(v_capture_name), '[[:space:]]+');
        v_full_name := trim(v_capture_name);
        update public.persons p
        set first_name = left(v_name_parts[1], 120),
            last_name = nullif(left(array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' '), 180), ''),
            updated_at = clock_timestamp()
        where p.id = v_person_id and p.studio_id = target_studio_id;
        update public.crm_conversations
        set contact_name = v_full_name, updated_at = clock_timestamp()
        where studio_id = target_studio_id and id = v_crm_conversation_id;
        v_identity_needs_name := false;
      end if;
    end if;
  end if;

  v_identity_needs_name := case
    when v_student_id is not null then false
    else v_identity_needs_name or v_new_contact
  end;

  if v_assistant_conversation_id is null then
    insert into public.assistant_conversations(
      studio_id,
      channel,
      external_thread_ref,
      crm_conversation_id,
      student_id,
      status,
      context
    )
    values (
      target_studio_id,
      'whatsapp',
      v_wa_id,
      v_crm_conversation_id,
      v_student_id,
      'open',
      case
        when v_crm_contact_id is not null
          then jsonb_build_object(
            'crm_contact_id', v_crm_contact_id,
            'contact_phone', v_phone,
            'provider', 'meta_whatsapp',
            'identity_needs_name', v_identity_needs_name
          )
        else jsonb_build_object(
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp'
        )
      end
    )
    returning id into v_assistant_conversation_id;
  else
    update public.assistant_conversations
    set crm_conversation_id = v_crm_conversation_id,
        student_id = coalesce(student_id, v_student_id),
        context = context || jsonb_build_object(
          'crm_contact_id', v_crm_contact_id,
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp',
          'identity_needs_name', v_identity_needs_name
        ),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  select exists (
    select 1
    from public.assistant_handoffs h
    where h.studio_id = target_studio_id
      and h.conversation_id = v_assistant_conversation_id
      and h.status = 'open'
  ) into v_handoff_open;

  if not v_handoff_open and coalesce(v_existing_status, 'open') = 'closed' then
    update public.assistant_conversations
    set status = 'open',
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  insert into public.assistant_turns(
    studio_id,
    conversation_id,
    direction,
    role,
    content,
    sanitized,
    channel_message_ref,
    created_at
  )
  values (
    target_studio_id,
    v_assistant_conversation_id,
    'inbound',
    'user',
    left(v_message_text, 2000),
    true,
    v_provider_message_id,
    v_activity_at
  )
  on conflict (studio_id, channel_message_ref)
  where channel_message_ref is not null
  do nothing
  returning id into v_inbound_turn_id;

  if v_inbound_turn_id is null then
    select t.id
      into v_inbound_turn_id
    from public.assistant_turns t
    where t.studio_id = target_studio_id
      and t.channel_message_ref = v_provider_message_id
    limit 1;
  end if;

  update public.assistant_whatsapp_events
  set assistant_conversation_id = v_assistant_conversation_id,
      inbound_turn_id = v_inbound_turn_id,
      updated_at = clock_timestamp()
  where id = target_event_id
    and studio_id = target_studio_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'crm_contact_id', v_crm_contact_id,
    'crm_conversation_id', v_crm_conversation_id,
    'assistant_conversation_id', v_assistant_conversation_id,
    'inbound_turn_id', v_inbound_turn_id,
    'handoff_open', v_handoff_open,
    'phone_e164', v_phone,
    'identity_needs_name', v_identity_needs_name
  );
end;
$function$


-- Preserve student-only identity resolution when the phone is also a coach contact.
CREATE OR REPLACE FUNCTION public.student_guest_invitation_contact_lookup(target_guest_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_crm public.crm_contacts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_guest_phone !~ E'^\\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'reason_code','guest_phone_invalid');
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select p.* into v_person
  from public.person_contacts pc
  join public.persons p
    on p.id=pc.person_id
   and p.studio_id=pc.studio_id
  where pc.studio_id=v_student.studio_id
    and pc.kind='phone' and pc.phone_role='student'
    and case
      when btrim(pc.value) like '+%' then
        '+' || regexp_replace(pc.value,'[^0-9]','','g')
      else
        (
          select st.phone_country_calling_code
          from public.studios st
          where st.id=v_student.studio_id
        ) || regexp_replace(pc.value,'[^0-9]','','g')
    end = target_guest_phone
  order by pc.is_primary desc, pc.created_at asc
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'found',false);
  end if;

  select * into v_crm
  from public.crm_contacts
  where studio_id=v_student.studio_id
    and person_id=v_person.id;

  return jsonb_build_object(
    'ok',true,
    'found',true,
    'person_id',v_person.id,
    'display_name',trim(concat_ws(' ',v_person.first_name,v_person.last_name)),
    'lifecycle_status',coalesce(v_crm.lifecycle_status,'trial')
  );
end;
$function$;
