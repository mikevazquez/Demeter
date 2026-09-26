
do $$
declare
  v_studio_id uuid;
  v_count integer;
  v_secret_name text;
  v_payload jsonb;
begin
  select count(*) into v_count
  from public.studios
  where lower(name) like 'demeter%';

  if v_count <> 1 then
    raise exception 'demeter_studio_resolution_failed';
  end if;

  select id into v_studio_id
  from public.studios
  where lower(name) like 'demeter%'
  limit 1;

  v_secret_name := 'meta_whatsapp_connection:' || v_studio_id::text;

  select decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets
  where name = v_secret_name
  limit 1;

  if v_payload is null then
    raise exception 'meta_whatsapp_not_configured';
  end if;

  if v_payload->'templates'->>'student_welcome' <> 'demeter_bienvenida'
     or v_payload->'templates'->>'reservation_confirmed' <> 'demeter_reserva_confirmada'
     or v_payload->'templates'->>'reservation_cancelled' <> 'demeter_reserva_cancelada'
     or v_payload->'templates'->>'waitlist_promoted' <> 'demeter_lista_espera'
     or v_payload->'templates'->>'class_reminder' <> 'demeter_recordatorio_clase'
     or v_payload->'templates'->>'class_cancelled_coach' <> 'demeter_clase_cancelada_coach'
  then
    raise exception 'meta_template_mapping_not_ready';
  end if;

  update public.notification_studio_channel_providers
  set is_default = false, updated_at = clock_timestamp()
  where studio_id = v_studio_id
    and channel_key = 'whatsapp';

  insert into public.notification_studio_channel_providers (
    studio_id, channel_key, provider_key, adapter_key, enabled, is_default
  ) values
    (v_studio_id, 'whatsapp', 'asistian', 'asistian', true, false),
    (v_studio_id, 'whatsapp', 'meta_whatsapp', 'meta_whatsapp', true, true)
  on conflict (studio_id, channel_key, provider_key) do update
  set
    adapter_key = excluded.adapter_key,
    enabled = excluded.enabled,
    is_default = excluded.is_default,
    updated_at = clock_timestamp();
end;
$$;

drop function if exists public.service_store_meta_connection_once(text,jsonb);
