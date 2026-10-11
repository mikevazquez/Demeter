CREATE OR REPLACE FUNCTION public.admin_set_instructor_status(p_instructor_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_studio_id uuid;
begin
  if p_status not in ('active', 'inactive') then raise exception 'status_invalid'; end if;
  select studio_id into v_studio_id from public.instructors where id = p_instructor_id;
  if v_studio_id is null or not private.has_capability(v_studio_id, 'instructors.write') then raise exception 'forbidden'; end if;
  if exists(select 1 from public.instructors where id=p_instructor_id and staff_role='admin') and not exists(select 1 from public.studio_memberships where studio_id=v_studio_id and user_id=(select auth.uid()) and active and role='owner') then raise exception 'owner_required'; end if;
  if p_status='inactive' then perform public.admin_deactivate_team_member(p_instructor_id,null);return;end if;
  update public.instructors set status = p_status, updated_at = now() where id = p_instructor_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_update_instructor_phone(p_instructor_id uuid, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_studio_id uuid; v_person_id uuid; v_phone text;
begin
 select studio_id,person_id into v_studio_id,v_person_id
 from public.instructors where id=p_instructor_id;
 if v_studio_id is null or not private.has_capability(v_studio_id,'instructors.write')
   then raise exception 'forbidden' using errcode='42501'; end if;
 if exists(select 1 from public.instructors where id=p_instructor_id and staff_role='admin') and not exists(select 1 from public.studio_memberships where studio_id=v_studio_id and user_id=(select auth.uid()) and active and role='owner') then raise exception 'owner_required';end if;
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
end $function$
;

