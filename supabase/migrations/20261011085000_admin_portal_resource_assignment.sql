create or replace function public.admin_assign_reservation_resource(p_reservation_id uuid,p_resource_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;s public.class_sessions%rowtype;sr public.session_resources%rowtype;v_used integer;v_id uuid;
begin
select * into r from public.reservations where id=p_reservation_id for update;
if not found then raise exception 'reservation_not_found';end if;
if auth.uid() is null or not private.has_capability(r.studio_id,'settings.write') then raise exception 'forbidden';end if;
if r.status not in ('reserved','attended') then raise exception 'reservation_not_active';end if;
select * into s from public.class_sessions where id=r.session_id and studio_id=r.studio_id for update;
if s.status='cancelled' or not s.requires_resource then raise exception 'session_resource_not_available';end if;
select * into sr from public.session_resources where session_id=s.id and resource_id=p_resource_id and studio_id=r.studio_id for update;
if not found or not sr.enabled or not exists(select 1 from public.resources where id=p_resource_id and studio_id=r.studio_id and space_id=s.space_id and active) then raise exception 'resource_not_available';end if;
select count(*) into v_used from public.reservation_resource_assignments where session_id=s.id and resource_id=p_resource_id and released_at is null and reservation_id<>r.id;
if v_used>=coalesce(sr.capacity_override,s.resource_uses_per_item,1) then raise exception 'resource_full';end if;
select id into v_id from public.reservation_resource_assignments where reservation_id=r.id and resource_id=p_resource_id and released_at is null;
if v_id is not null then return v_id;end if;
update public.reservation_resource_assignments set released_at=now(),release_reason='admin_reassigned:'||p_resource_id::text where reservation_id=r.id and released_at is null;
insert into public.reservation_resource_assignments(studio_id,session_id,reservation_id,resource_id,assigned_by) values(r.studio_id,s.id,r.id,p_resource_id,auth.uid()) returning id into v_id;
return v_id;
end;$$;
revoke all on function public.admin_assign_reservation_resource(uuid,uuid) from public,anon;
grant execute on function public.admin_assign_reservation_resource(uuid,uuid) to authenticated;
revoke execute on function public.admin_set_acquisition_start_date(uuid,date),public.admin_set_acquisition_available_credits(uuid,integer,text) from authenticated;
