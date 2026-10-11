create or replace function public.admin_notification_provider_readiness(p_studio_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare push_ready boolean;
begin
 if not private.has_capability(p_studio_id,'automations.read') then raise exception 'forbidden';end if;
 select count(distinct name)=3 into push_ready from vault.decrypted_secrets
 where name in ('web_push_vapid_public_key:v1','web_push_vapid_private_key:v1','web_push_vapid_subject:v1') and nullif(trim(decrypted_secret),'') is not null;
 return jsonb_build_object('push_configured',push_ready);
end $$;
revoke all on function public.admin_notification_provider_readiness(uuid) from public,anon;
grant execute on function public.admin_notification_provider_readiness(uuid) to authenticated;
