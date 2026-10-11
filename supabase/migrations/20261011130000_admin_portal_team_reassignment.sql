create or replace function public.admin_deactivate_team_member(p_instructor_id uuid,p_replacement_instructor_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare member public.instructors%rowtype; replacement public.instructors%rowtype; future_count integer;
begin
 select * into member from public.instructors where id=p_instructor_id for update;
 if not found or not private.has_capability(member.studio_id,'instructors.write') then raise exception 'forbidden'; end if;
 if member.staff_role='admin' and not exists(select 1 from public.studio_memberships where studio_id=member.studio_id and user_id=(select auth.uid()) and active and role='owner') then raise exception 'owner_required'; end if;
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
end; $$;

