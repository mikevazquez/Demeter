alter table public.students add column acquisition_source text;
CREATE OR REPLACE FUNCTION public.admin_create_student_profile(p_studio_id uuid, p_first_name text, p_last_name text, p_phone text, p_email text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_studio_id uuid; v_person_id uuid; v_student_id uuid; v_full_name text; v_email text;
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio_id,'students.write') then raise exception 'students_write_denied'; end if;
  v_studio_id:=p_studio_id;
  if p_source is not null and p_source not in ('Instagram','Facebook','Google','Recomendación','Visita al estudio','Otro') then raise exception 'student_source_invalid'; end if;
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
  update public.students set acquisition_source=p_source where id=v_student_id;
  return v_student_id;
end;$function$
;
revoke all on function public.admin_create_student_profile(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.admin_create_student_profile(uuid,text,text,text,text,text) to authenticated;
