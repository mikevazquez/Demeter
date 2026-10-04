-- Demi · Sandbox pilot phone-number-id self-heal.
-- A signed Meta webhook from the explicitly allowlisted pilot contact may refresh
-- the configured Meta Phone Number ID. This function is service-role only.

create or replace function public.service_sync_meta_whatsapp_phone_number_id(
  target_studio_id uuid,
  target_phone_number_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_payload jsonb;
  v_phone_number_id text := trim(coalesce(target_phone_number_id, ''));
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null or v_phone_number_id !~ '^[0-9]+$' then
    raise exception 'meta_phone_number_id_invalid';
  end if;

  select s.id, s.decrypted_secret::jsonb
    into v_secret_id, v_payload
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null or v_payload is null then
    raise exception 'meta_whatsapp_not_configured';
  end if;

  v_payload := jsonb_set(
    v_payload,
    '{phone_number_id}',
    to_jsonb(v_phone_number_id),
    true
  );

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection'
  );

  return true;
end;
$function$;

revoke all on function public.service_sync_meta_whatsapp_phone_number_id(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_sync_meta_whatsapp_phone_number_id(uuid,text)
to service_role;
