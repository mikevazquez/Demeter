-- Safely repair legacy Meta WhatsApp tokens and configure Demi inbound credentials.
-- This is additive to Asistian; it does not change the default WhatsApp provider or pilot mode.

create or replace function public.admin_set_meta_whatsapp_connection(
  target_studio_id uuid,
  target_access_token text,
  target_phone_number_id text,
  target_waba_id text,
  target_graph_api_version text,
  target_app_secret text,
  target_verify_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_existing text;
  v_payload jsonb := '{}'::jsonb;
  v_access_token text := trim(coalesce(target_access_token, ''));
  v_phone_number_id text := trim(coalesce(target_phone_number_id, ''));
  v_waba_id text := trim(coalesce(target_waba_id, ''));
  v_graph_api_version text := trim(coalesce(target_graph_api_version, ''));
  v_app_secret text := trim(coalesce(target_app_secret, ''));
  v_verify_token text := trim(coalesce(target_verify_token, ''));
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if length(v_access_token) < 20 or length(v_access_token) > 8192 then
    raise exception 'meta_access_token_invalid';
  end if;
  if v_phone_number_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_phone_number_id_invalid';
  end if;
  if v_waba_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_waba_id_invalid';
  end if;
  if v_graph_api_version !~ '^v[0-9]+\.[0-9]+$' then
    raise exception 'meta_graph_api_version_invalid';
  end if;
  if length(v_app_secret) < 16 or length(v_app_secret) > 512 then
    raise exception 'meta_app_secret_invalid';
  end if;

  if v_verify_token = '' then
    v_verify_token :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');
  end if;
  if length(v_verify_token) < 16
     or length(v_verify_token) > 128
     or v_verify_token !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'meta_verify_token_invalid';
  end if;

  select s.id, s.decrypted_secret
    into v_secret_id, v_existing
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    raise exception 'meta_whatsapp_not_configured';
  end if;

  if pg_input_is_valid(v_existing, 'jsonb') then
    v_payload := v_existing::jsonb;
    if jsonb_typeof(v_payload) <> 'object' then
      v_payload := '{}'::jsonb;
    end if;
  end if;

  v_payload := v_payload || jsonb_build_object(
    'access_token', v_access_token,
    'phone_number_id', v_phone_number_id,
    'waba_id', v_waba_id,
    'graph_api_version', v_graph_api_version,
    'app_secret', v_app_secret,
    'verify_token', v_verify_token,
    'country_calling_code', coalesce(nullif(v_payload->>'country_calling_code', ''), '52'),
    'language_code', coalesce(nullif(v_payload->>'language_code', ''), 'es_MX'),
    'templates', case when jsonb_typeof(v_payload->'templates') = 'object'
                      then v_payload->'templates' else '{}'::jsonb end,
    'pilot_wa_ids', case when jsonb_typeof(v_payload->'pilot_wa_ids') = 'array'
                         then v_payload->'pilot_wa_ids' else '[]'::jsonb end
  );

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection'
  );

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'phone_number_id', v_phone_number_id,
    'verify_token', v_verify_token
  );
end;
$function$;

revoke all on function public.admin_set_meta_whatsapp_connection(uuid,text,text,text,text,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_whatsapp_connection(uuid,text,text,text,text,text,text)
to authenticated;

create or replace function public.admin_get_meta_whatsapp_inbound_summary(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_payload jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null then
    return jsonb_build_object('connected', false, 'webhook_configured', false, 'connection_repair_required', false);
  end if;

  if not pg_input_is_valid(v_secret, 'jsonb') then
    return jsonb_build_object('connected', true, 'webhook_configured', false, 'connection_repair_required', true);
  end if;

  v_payload := v_secret::jsonb;
  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('connected', true, 'webhook_configured', false, 'connection_repair_required', true);
  end if;

  return jsonb_build_object(
    'connected', true,
    'webhook_configured',
      nullif(trim(coalesce(v_payload->>'phone_number_id', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'access_token', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'app_secret', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'verify_token', '')), '') is not null,
    'connection_repair_required', false,
    'phone_number_id', v_payload->>'phone_number_id',
    'verify_token', v_payload->>'verify_token'
  );
end;
$function$;

revoke all on function public.admin_get_meta_whatsapp_inbound_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_whatsapp_inbound_summary(uuid)
to authenticated;

create or replace function public.admin_get_meta_whatsapp_pilot_summary(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_payload jsonb;
  v_wa_id text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return jsonb_build_object('pilot_contact_configured', false, 'pilot_contact_masked', null);
  end if;

  v_payload := v_secret::jsonb;
  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('pilot_contact_configured', false, 'pilot_contact_masked', null);
  end if;

  select value into v_wa_id
  from jsonb_array_elements_text(coalesce(v_payload->'pilot_wa_ids', '[]'::jsonb))
  limit 1;

  return jsonb_build_object(
    'pilot_contact_configured', v_wa_id is not null,
    'pilot_contact_masked', case when v_wa_id is null then null else '••••' || right(v_wa_id, 4) end
  );
end;
$function$;

revoke all on function public.admin_get_meta_whatsapp_pilot_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_whatsapp_pilot_summary(uuid)
to authenticated;

create or replace function public.service_get_meta_whatsapp_connection(target_studio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return null;
  end if;
  if jsonb_typeof(v_secret::jsonb) <> 'object' then
    return null;
  end if;
  return v_secret::jsonb;
end;
$function$;

revoke all on function public.service_get_meta_whatsapp_connection(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_meta_whatsapp_connection(uuid)
to service_role;

create or replace function public.service_get_meta_whatsapp_webhook_config(target_studio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_payload jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return null;
  end if;
  v_payload := v_secret::jsonb;
  if jsonb_typeof(v_payload) <> 'object' then
    return null;
  end if;

  return jsonb_build_object(
    'access_token', v_payload->>'access_token',
    'phone_number_id', v_payload->>'phone_number_id',
    'waba_id', v_payload->>'waba_id',
    'graph_api_version', v_payload->>'graph_api_version',
    'country_calling_code', coalesce(v_payload->>'country_calling_code', '52'),
    'app_secret', v_payload->>'app_secret',
    'verify_token', v_payload->>'verify_token'
  );
end;
$function$;

revoke all on function public.service_get_meta_whatsapp_webhook_config(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_meta_whatsapp_webhook_config(uuid)
to service_role;
