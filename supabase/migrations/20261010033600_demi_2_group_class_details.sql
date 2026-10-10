create function public.service_get_demi_group_class_details(p_studio uuid,p_conversation uuid,p_group uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select jsonb_build_object('activity',t.name,'date',to_char(cs.starts_at at time zone s.timezone,'YYYY-MM-DD'),'starts_at_local',to_char(cs.starts_at at time zone s.timezone,'HH24:MI'),'ends_at_local',to_char(cs.ends_at at time zone s.timezone,'HH24:MI'),'location',l.name,'address',l.address,'timezone',s.timezone)
 into result from public.demi_group_bookings g join public.class_sessions cs on cs.id=g.session_id and cs.studio_id=g.studio_id join public.studios s on s.id=g.studio_id join public.class_templates t on t.id=cs.template_id and t.studio_id=cs.studio_id left join public.studio_locations l on l.id=cs.location_id and l.studio_id=cs.studio_id and l.active where g.id=p_group and g.studio_id=p_studio and g.conversation_id=p_conversation;
 return result;
end $$;
revoke all on function public.service_get_demi_group_class_details(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_get_demi_group_class_details(uuid,uuid,uuid) to service_role;
