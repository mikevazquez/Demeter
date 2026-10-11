CREATE OR REPLACE FUNCTION public.admin_create_team_member(p_studio_id uuid, p_first_name text, p_last_name text, p_phone text, p_email text, p_role text, p_teaches boolean, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if p_role is null or p_role not in ('instructor','reception','admin') then raise exception 'team_role_invalid'; end if;
 v_id:=public.admin_create_instructor_scoped(p_studio_id,p_first_name,p_last_name,p_phone,p_email,p_note);
 update public.instructors set staff_role=p_role::public.studio_role,teaches=(p_role='instructor' or coalesce(p_teaches,false)) where id=v_id;
 return v_id;
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_deactivate_team_member(p_instructor_id uuid, p_replacement_instructor_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare member public.instructors%rowtype; replacement public.instructors%rowtype; future_count integer;
begin
 select * into member from public.instructors where id=p_instructor_id for update;
 if not found or not private.has_capability(member.studio_id,'instructors.write') then raise exception 'forbidden'; end if;
 perform 1 from public.class_sessions where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now() for update;
 select count(*) into future_count from public.class_sessions where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now();
 if future_count>0 or p_replacement_instructor_id is not null or exists(select 1 from public.recurring_schedules where instructor_id=member.id and studio_id=member.studio_id and active) then
 select * into replacement from public.instructors where id=p_replacement_instructor_id and studio_id=member.studio_id and status='active' and teaches and id<>member.id for update;
 if not found then raise exception 'replacement_required'; end if;
 update public.class_sessions set instructor_id=replacement.id,is_schedule_exception=true where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now();
 update public.recurring_schedules set instructor_id=replacement.id where instructor_id=member.id and studio_id=member.studio_id and active;
 end if;
 update public.instructors set status='inactive',updated_at=now() where id=member.id;
 update public.studio_memberships set active=false where studio_id=member.studio_id and person_id=member.person_id and role<>'owner';
 return future_count;
end; $function$
;
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
