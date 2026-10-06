-- Point Demeter's reservation confirmation to the approved QR image template.
-- Preserves every other Meta WhatsApp credential and template mapping.

do $$
declare
  v_studio_id uuid;
  v_secret_name text;
  v_secret_id uuid;
  v_payload jsonb;
  v_templates jsonb;
begin
  select id
    into v_studio_id
  from public.studios
  where lower(name) = 'demeter fitness studio'
  limit 1;

  if v_studio_id is null then
    return;
  end if;

  v_secret_name := 'meta_whatsapp_connection:' || v_studio_id::text;

  select s.id, s.decrypted_secret::jsonb
    into v_secret_id, v_payload
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null or v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    return;
  end if;

  v_templates := case
    when jsonb_typeof(v_payload->'templates') = 'object'
      then v_payload->'templates'
    else '{}'::jsonb
  end;

  v_templates := v_templates || jsonb_build_object(
    'reservation_confirmed',
    'demeter_reserva_confirmada_qr_v3'
  );

  v_payload := jsonb_set(v_payload, '{templates}', v_templates, true);

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection'
  );
end;
$$;
