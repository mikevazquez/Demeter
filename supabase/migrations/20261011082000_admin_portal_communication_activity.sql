create or replace function public.admin_communication_activity(p_studio_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
if auth.uid() is null or not private.has_capability(p_studio_id,'automations.read') then raise exception 'forbidden'; end if;
return coalesce((select jsonb_agg(to_jsonb(n)) from (select id,notification_type,state,state_reason_detail,created_at,scheduled_for,recipient_entity_id,recipient_type,template_variables from public.notifications where studio_id=p_studio_id order by created_at desc limit 100) n),'[]'::jsonb);
end; $$;
revoke all on function public.admin_communication_activity(uuid) from public,anon;
grant execute on function public.admin_communication_activity(uuid) to authenticated;
