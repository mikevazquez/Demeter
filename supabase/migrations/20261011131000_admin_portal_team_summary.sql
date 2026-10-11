create or replace function public.admin_team_summary(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; tz text;week_start timestamptz;
begin
if not private.has_capability(p_studio_id,'instructors.read') then raise exception 'forbidden';end if;
select coalesce(timezone,'America/Mexico_City') into tz from public.studios where id=p_studio_id;
week_start:=date_trunc('week',now() at time zone tz) at time zone tz;
select coalesce(jsonb_agg(jsonb_build_object('instructor_id',i.id,'access_status',case when sm.user_id is null or not sm.active or ua.status<>'active' then 'none' when ua.must_change_password then 'pending' else 'active' end,'last_sign_in_at',au.last_sign_in_at,'classes_this_week',(select count(*) from public.class_sessions cs where cs.studio_id=i.studio_id and cs.instructor_id=i.id and cs.status<>'cancelled' and cs.starts_at>=week_start and cs.starts_at<(date_trunc('week',now() at time zone tz)+interval '7 days') at time zone tz))), '[]'::jsonb)
into result from public.instructors i
left join public.studio_memberships sm on sm.studio_id=i.studio_id and sm.person_id=i.person_id and sm.role=i.staff_role
left join public.user_accounts ua on ua.id=sm.user_id
left join auth.users au on au.id=sm.user_id
where i.studio_id=p_studio_id;
return result;
end $$;
revoke all on function public.admin_team_summary(uuid) from public,anon;
grant execute on function public.admin_team_summary(uuid) to authenticated;

