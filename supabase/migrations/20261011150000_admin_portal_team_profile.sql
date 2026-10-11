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
 if exists(select 1 from public.studio_memberships where studio_id=member.studio_id and person_id=member.person_id and role='owner') then raise exception 'owner_protected'; end if;
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

create or replace function public.admin_update_team_member(p_instructor_id uuid,p_first_name text,p_last_name text,p_phone text,p_email text,p_role text,p_teaches boolean,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare member public.instructors%rowtype; desired_teaches boolean; linked_user uuid; current_email text; email text;
begin
 select * into member from public.instructors where id=p_instructor_id for update;
 if not found or not private.has_capability(member.studio_id,'instructors.write') then raise exception 'forbidden' using errcode='42501';end if;
 if nullif(trim(p_first_name),'') is null then raise exception 'first_name_required';end if;
 if p_role is null or p_role not in ('instructor','reception','admin') then raise exception 'team_role_invalid';end if;
 desired_teaches:=p_role='instructor' or coalesce(p_teaches,false);
 if exists(select 1 from public.studio_memberships where studio_id=member.studio_id and person_id=member.person_id and role='owner') and (p_role<>member.staff_role::text or desired_teaches<>member.teaches) then raise exception 'owner_protected';end if;
 if not desired_teaches and (exists(select 1 from public.class_sessions where studio_id=member.studio_id and instructor_id=member.id and status='scheduled' and starts_at>now()) or exists(select 1 from public.recurring_schedules where studio_id=member.studio_id and instructor_id=member.id and active)) then raise exception 'teaching_assignments_exist';end if;
 email:=nullif(lower(trim(coalesce(p_email,''))),'');
 if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'email_invalid';end if;
 select user_id into linked_user from public.studio_memberships where studio_id=member.studio_id and person_id=member.person_id and role=member.staff_role limit 1;
 if linked_user is not null then
   select lower(au.email) into current_email from auth.users au where au.id=linked_user;
   if email is distinct from current_email then raise exception 'linked_email_locked';end if;
 end if;
 if email is not null and exists(select 1 from public.person_contacts c join public.instructors i on i.person_id=c.person_id and i.studio_id=c.studio_id where c.studio_id=member.studio_id and c.kind='email' and lower(c.value)=email and c.person_id<>member.person_id) then raise exception 'email_in_use' using errcode='23505';end if;
 perform public.admin_update_instructor_phone(member.id,p_phone);
 update public.persons set first_name=trim(p_first_name),last_name=nullif(trim(coalesce(p_last_name,'')),'') where id=member.person_id and studio_id=member.studio_id;
 delete from public.person_contacts where studio_id=member.studio_id and person_id=member.person_id and kind='email';
 if email is not null then insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(member.studio_id,member.person_id,'email',email,true);end if;
 update public.instructors set staff_role=p_role::public.studio_role,teaches=desired_teaches,bio=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=member.id;
 update public.studio_memberships set role=p_role::public.studio_role where studio_id=member.studio_id and person_id=member.person_id and role=member.staff_role;
end $$;
revoke all on function public.admin_update_team_member(uuid,text,text,text,text,text,boolean,text) from public,anon;
grant execute on function public.admin_update_team_member(uuid,text,text,text,text,text,boolean,text) to authenticated;

create or replace function public.admin_team_profile(p_instructor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member public.instructors%rowtype;result jsonb;
begin
 select * into member from public.instructors where id=p_instructor_id;
 if not found or not private.has_capability(member.studio_id,'instructors.read') then raise exception 'forbidden';end if;
 with past as (
 select cs.id,cs.status,cs.capacity from public.class_sessions cs where cs.studio_id=member.studio_id and cs.instructor_id=member.id and cs.starts_at>=now()-interval '30 days' and cs.ends_at<=now()
 ), attendance as (
 select r.student_id from public.reservations r join past p on p.id=r.session_id where p.status<>'cancelled' and r.status='attended'
 ), access as (
 select sm.role,sm.user_id,sm.active,ua.status,ua.must_change_password,au.last_sign_in_at from public.studio_memberships sm left join public.user_accounts ua on ua.id=sm.user_id left join auth.users au on au.id=sm.user_id where sm.studio_id=member.studio_id and sm.person_id=member.person_id and sm.role in (member.staff_role,'owner') order by (sm.role='owner') desc limit 1
 )
 select jsonb_build_object('is_owner',exists(select 1 from access where role='owner'),'access_status',coalesce((select case when not active or status is distinct from 'active' then 'none' when must_change_password then 'pending' else 'active' end from access),'none'),'last_sign_in_at',(select last_sign_in_at from access),'email_locked',exists(select 1 from access),'classes_taught',(select count(*) from past where status<>'cancelled'),'cancelled_classes',(select count(*) from past where status='cancelled'),'attendances',(select count(*) from attendance),'capacity',(select coalesce(sum(capacity),0) from past where status<>'cancelled'),'unique_students',(select count(distinct student_id) from attendance),'future_classes',(select count(*) from public.class_sessions where studio_id=member.studio_id and instructor_id=member.id and status='scheduled' and starts_at>now()),'has_recurring',exists(select 1 from public.recurring_schedules where studio_id=member.studio_id and instructor_id=member.id and active)) into result;
 return result;
end $$;
revoke all on function public.admin_team_profile(uuid) from public,anon;
grant execute on function public.admin_team_profile(uuid) to authenticated;
