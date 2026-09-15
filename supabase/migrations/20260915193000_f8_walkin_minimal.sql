-- F8 SF-077: minimal walk-in registration without pulling F9 sales into attendance.
-- The reservation intentionally has no acquisition. A sale/product can be linked later by F9.
create or replace function public.create_walkin_student(
  target_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_reservation_id uuid;
  v_full_name text;
  v_count integer;
begin
  select * into v_session from public.class_sessions where id = target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;
  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.has_capability(v_session.studio_id, 'students.write') then raise exception 'forbidden'; end if;
  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;
  if exists(select 1 from public.person_contacts where studio_id=v_session.studio_id and kind='phone' and value=p_phone) then raise exception 'phone_exists'; end if;

  select count(*) into v_count from public.reservations where session_id=target_session_id and status in ('reserved','attended','no_show');
  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  insert into public.persons(studio_id, first_name, last_name)
  values(v_session.studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name,'')),'')) returning id into v_person_id;
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_id,v_session.studio_id,'phone',p_phone,true);

  v_full_name := trim(p_first_name || case when nullif(trim(coalesce(p_last_name,'')),'') is not null then ' '||trim(p_last_name) else '' end);
  insert into public.students(studio_id,person_id,full_name,phone,active,lifecycle_status,profile_status)
  values(v_session.studio_id,v_person_id,v_full_name,p_phone,true,'active','incomplete') returning id into v_student_id;
  update public.students set profile_status=private.student_profile_status(v_student_id),updated_at=now() where id=v_student_id;

  insert into public.reservations(studio_id,session_id,student_id,status,credits_held)
  values(v_session.studio_id,target_session_id,v_student_id,'reserved',1) returning id into v_reservation_id;

  return jsonb_build_object('ok',true,'student_id',v_student_id,'reservation_id',v_reservation_id,'walkin',true);
end;
$$;
revoke all on function public.create_walkin_student(uuid,text,text,text) from public,anon;
grant execute on function public.create_walkin_student(uuid,text,text,text) to authenticated;
