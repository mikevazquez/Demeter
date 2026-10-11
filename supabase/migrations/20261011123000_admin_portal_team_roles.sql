alter table public.instructors add column staff_role public.studio_role not null default 'instructor' check(staff_role in ('instructor','reception','admin')),add column teaches boolean not null default true;
create or replace function public.admin_create_team_member(p_studio_id uuid,p_first_name text,p_last_name text,p_phone text,p_email text,p_role text,p_teaches boolean,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if p_role is null or p_role not in ('instructor','reception','admin') then raise exception 'team_role_invalid'; end if;
 if p_role='admin' and not exists(select 1 from public.studio_memberships where studio_id=p_studio_id and user_id=(select auth.uid()) and active and role='owner') then raise exception 'owner_required'; end if;
 v_id:=public.admin_create_instructor_scoped(p_studio_id,p_first_name,p_last_name,p_phone,p_email,p_note);
 update public.instructors set staff_role=p_role::public.studio_role,teaches=(p_role='instructor' or coalesce(p_teaches,false)) where id=v_id;
 return v_id;
end; $$;
create or replace function public.admin_deactivate_team_member(p_instructor_id uuid,p_replacement_instructor_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare member public.instructors%rowtype; replacement public.instructors%rowtype; future_count integer;
begin
 select * into member from public.instructors where id=p_instructor_id for update;
 if not found or not private.has_capability(member.studio_id,'instructors.write') then raise exception 'forbidden'; end if;
 if member.staff_role='admin' and not exists(select 1 from public.studio_memberships where studio_id=member.studio_id and user_id=(select auth.uid()) and active and role='owner') then raise exception 'owner_required'; end if;
 perform 1 from public.class_sessions where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now() for update;
 select count(*) into future_count from public.class_sessions where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now();
 if future_count>0 or p_replacement_instructor_id is not null then
 select * into replacement from public.instructors where id=p_replacement_instructor_id and studio_id=member.studio_id and status='active' and teaches and id<>member.id for update;
 if not found then raise exception 'replacement_required'; end if;
 update public.class_sessions set instructor_id=replacement.id,is_schedule_exception=true,updated_at=now() where instructor_id=member.id and studio_id=member.studio_id and status='scheduled' and starts_at>now();
 update public.recurring_schedules set instructor_id=replacement.id where instructor_id=member.id and studio_id=member.studio_id and active;
 end if;
 update public.instructors set status='inactive',updated_at=now() where id=member.id;
 update public.studio_memberships set active=false where studio_id=member.studio_id and person_id=member.person_id and role<>'owner';
 return future_count;
end; $$;
revoke all on function public.admin_create_team_member(uuid,text,text,text,text,text,boolean,text),public.admin_deactivate_team_member(uuid,uuid) from public,anon;
grant execute on function public.admin_create_team_member(uuid,text,text,text,text,text,boolean,text),public.admin_deactivate_team_member(uuid,uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.service_link_instructor_access(target_instructor_id uuid, target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_instructor public.instructors%rowtype;
begin
  select i.*
    into v_instructor
  from public.instructors i
  where i.id = target_instructor_id
  for update;

  if not found then raise exception 'instructor_not_found'; end if;
  if v_instructor.status <> 'active' then raise exception 'instructor_not_active'; end if;

  if exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = v_instructor.studio_id
      and sm.person_id = v_instructor.person_id
      and sm.role = v_instructor.staff_role
      and sm.user_id <> target_user_id
  ) then
    raise exception 'instructor_already_linked';
  end if;

  if exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = v_instructor.studio_id
      and sm.user_id = target_user_id
      and sm.role <> v_instructor.staff_role
  ) then
    raise exception 'account_has_other_studio_role';
  end if;

  insert into public.user_accounts (id, status, must_change_password)
  values (target_user_id, 'active', true)
  on conflict (id) do update
    set status = 'active',
        must_change_password = true,
        updated_at = now();

  insert into public.studio_memberships (studio_id, user_id, role, active, person_id)
  values (
    v_instructor.studio_id,
    target_user_id,
    v_instructor.staff_role,
    true,
    v_instructor.person_id
  )
  on conflict (studio_id, user_id) do update
    set role = excluded.role,
        active = true,
        person_id = excluded.person_id;
end;
$function$
;

