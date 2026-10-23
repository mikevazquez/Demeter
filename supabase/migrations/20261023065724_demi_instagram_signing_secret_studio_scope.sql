-- Instagram Login uses its own signing key, independently of Facebook Messenger.
-- Only trusted server callers may read the key for the explicitly selected studio.
create or replace function public.service_get_meta_instagram_app_secret(target_studio_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_studio_id is null then
    return null;
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_instagram_app_secret:' || target_studio_id::text
  limit 1;

  return v_secret;
end;
$function$;

revoke all on function public.service_get_meta_instagram_app_secret(uuid) from public, anon, authenticated;
grant execute on function public.service_get_meta_instagram_app_secret(uuid) to service_role;
