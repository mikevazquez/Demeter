-- WHATSAPP-META-01 · Direct Meta WhatsApp Cloud API connection per studio.
-- Stores the access token encrypted in Vault and swaps only the WhatsApp delivery adapter.

create or replace function public.admin_set_meta_whatsapp_connection(
  target_studio_id uuid,
  target_waba_id text,
  target_phone_number_id text,
  target_access_token text,
  target_graph_api_version text default 'v26.0',
  target_language_code text default 'es_MX',
  target_country_calling_code text default '52',
  target_templates jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waba_id text := trim(coalesce(target_waba_id, ''));
  v_phone_number_id text := trim(coalesce(target_phone_number_id, ''));
  v_access_token text := trim(coalesce(target_access_token, ''));
  v_graph_api_version text := trim(coalesce(target_graph_api_version, ''));
  v_language_code text := trim(coalesce(target_language_code, ''));
  v_country_calling_code text := trim(coalesce(target_country_calling_code, ''));
  v_templates jsonb := coalesce(target_templates, '{}'::jsonb);
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_payload jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_waba_id !~ '^[0-9]+$' then
    raise exception 'meta_waba_id_invalid';
  end if;

  if v_phone_number_id !~ '^[0-9]+$' then
    raise exception 'meta_phone_number_id_invalid';
  end if;

  if length(v_access_token) < 20 then
    raise exception 'meta_access_token_invalid';
  end if;

  if v_graph_api_version !~ '^v[0-9]+\.[0-9]+$' then
    raise exception 'meta_graph_api_version_invalid';
  end if;

  if v_language_code !~ '^[a-z]{2}_[A-Z]{2}$' then
    raise exception 'meta_language_code_invalid';
  end if;

  if v_country_calling_code !~ '^[1-9][0-9]{0,2}$' then
    raise exception 'meta_country_calling_code_invalid';
  end if;

  if jsonb_typeof(v_templates) <> 'object' then
    raise exception 'meta_templates_invalid';
  end if;

  if exists (
    select 1
    from jsonb_each_text(v_templates) as template_entry
    where template_entry.key not in (
      'student_welcome',
      'reservation_confirmed',
      'reservation_cancelled',
      'waitlist_promoted',
      'class_reminder',
      'class_cancelled_coach'
    )
       or trim(template_entry.value) !~ '^[a-z0-9_]+$'
  ) then
    raise exception 'meta_templates_invalid';
  end if;

  v_payload := jsonb_build_object(
    'waba_id', v_waba_id,
    'phone_number_id', v_phone_number_id,
    'access_token', v_access_token,
    'graph_api_version', v_graph_api_version,
    'language_code', v_language_code,
    'country_calling_code', v_country_calling_code,
    'templates', v_templates
  );

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      v_secret_name,
      'Studio Flow direct Meta WhatsApp Cloud API connection'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      v_secret_name,
      'Studio Flow direct Meta WhatsApp Cloud API connection'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_meta_whatsapp_connection(
  uuid,text,text,text,text,text,text,jsonb
) from public, anon, service_role;

grant execute on function public.admin_set_meta_whatsapp_connection(
  uuid,text,text,text,text,text,text,jsonb
) to authenticated;

create or replace function public.admin_get_meta_whatsapp_connection_summary(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_payload jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_payload is null then
    return jsonb_build_object('connected', false);
  end if;

  return jsonb_build_object(
    'connected', true,
    'waba_id', v_payload->>'waba_id',
    'phone_number_id', v_payload->>'phone_number_id',
    'graph_api_version', v_payload->>'graph_api_version',
    'language_code', v_payload->>'language_code',
    'country_calling_code', v_payload->>'country_calling_code',
    'templates', coalesce(v_payload->'templates', '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_meta_whatsapp_connection_summary(uuid)
from public, anon, service_role;

grant execute on function public.admin_get_meta_whatsapp_connection_summary(uuid)
to authenticated;

create or replace function public.service_get_meta_whatsapp_connection(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_payload jsonb;
begin
  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_payload;
end;
$$;

revoke all on function public.service_get_meta_whatsapp_connection(uuid)
from public, anon, authenticated;

grant execute on function public.service_get_meta_whatsapp_connection(uuid)
to service_role;

insert into public.notification_channel_adapters (
  channel_key, adapter_key, provider_key, enabled
) values
  ('whatsapp', 'meta_whatsapp', 'meta_whatsapp', true)
on conflict (channel_key) do update
set
  adapter_key = excluded.adapter_key,
  provider_key = excluded.provider_key,
  enabled = excluded.enabled,
  updated_at = clock_timestamp();
