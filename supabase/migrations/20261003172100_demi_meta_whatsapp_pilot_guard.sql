-- Demi · guarded WhatsApp pilot contact.
-- Stores the pilot WhatsApp allowlist inside the existing Meta connection Vault payload.
-- This keeps real inbound traffic inert while Demi is in pilot mode.

create or replace function public.admin_set_meta_whatsapp_pilot_contact(
  target_studio_id uuid,
  target_contact_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_payload jsonb;
  v_digits text := regexp_replace(coalesce(target_contact_phone, ''), '[^0-9]', '', 'g');
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_digits ~ '^[0-9]{10}$' then
    v_digits := '52' || v_digits;
  elsif v_digits ~ '^521[0-9]{10}$' then
    v_digits := '52' || substring(v_digits from 4);
  end if;

  if v_digits !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'pilot_phone_invalid';
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
    '{pilot_wa_ids}',
    jsonb_build_array(v_digits),
    true
  );

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection'
  );

  return jsonb_build_object(
    'ok', true,
    'pilot_contact_configured', true,
    'pilot_contact_masked', '••••' || right(v_digits, 4)
  );
end;
$function$;

revoke all on function public.admin_set_meta_whatsapp_pilot_contact(uuid,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_whatsapp_pilot_contact(uuid,text)
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
  v_payload jsonb;
  v_wa_id text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_payload is null then
    return jsonb_build_object(
      'pilot_contact_configured', false,
      'pilot_contact_masked', null
    );
  end if;

  select value
    into v_wa_id
  from jsonb_array_elements_text(coalesce(v_payload->'pilot_wa_ids', '[]'::jsonb))
  limit 1;

  return jsonb_build_object(
    'pilot_contact_configured', v_wa_id is not null,
    'pilot_contact_masked',
      case when v_wa_id is null then null else '••••' || right(v_wa_id, 4) end
  );
end;
$function$;

revoke all on function public.admin_get_meta_whatsapp_pilot_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_whatsapp_pilot_summary(uuid)
to authenticated;

create or replace function public.service_get_meta_whatsapp_pilot_wa_ids(
  target_studio_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_ids text[];
begin
  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_payload is null then
    return array[]::text[];
  end if;

  select coalesce(array_agg(value), array[]::text[])
    into v_ids
  from jsonb_array_elements_text(coalesce(v_payload->'pilot_wa_ids', '[]'::jsonb));

  return v_ids;
end;
$function$;

revoke all on function public.service_get_meta_whatsapp_pilot_wa_ids(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_meta_whatsapp_pilot_wa_ids(uuid)
to service_role;
