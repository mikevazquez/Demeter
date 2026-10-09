-- A configured Meta inbox requires either Messenger or Instagram, not both.
-- Preserve signature validation and all stored credentials.
create or replace function public.admin_get_meta_inbox_connection_summary(
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
  v_pilot jsonb;
  v_instagram_pilot text;
  v_messenger_pilot text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_inbox_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return jsonb_build_object('connected', false);
  end if;

  v_payload := v_secret::jsonb;
  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('connected', false);
  end if;

  v_pilot := case
    when jsonb_typeof(v_payload->'pilot_contact_ids') = 'object'
      then v_payload->'pilot_contact_ids'
    else '{}'::jsonb
  end;

  select value into v_instagram_pilot
  from jsonb_array_elements_text(coalesce(v_pilot->'instagram', '[]'::jsonb))
  limit 1;

  select value into v_messenger_pilot
  from jsonb_array_elements_text(coalesce(v_pilot->'facebook_messenger', '[]'::jsonb))
  limit 1;

  return jsonb_build_object(
    'connected',
      (
        (
          nullif(trim(coalesce(v_payload->>'page_access_token', '')), '') is not null
          and nullif(trim(coalesce(v_payload->>'page_id', '')), '') is not null
        )
        or
        (
          nullif(trim(coalesce(v_payload->>'instagram_access_token', '')), '') is not null
          and nullif(trim(coalesce(v_payload->>'instagram_user_id', '')), '') is not null
        )
      )
      and nullif(trim(coalesce(v_payload->>'app_secret', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'verify_token', '')), '') is not null,
    'page_id', v_payload->>'page_id',
    'instagram_user_id', v_payload->>'instagram_user_id',
    'graph_api_version', v_payload->>'graph_api_version',
    'verify_token', v_payload->>'verify_token',
    'instagram_pilot_masked', case
      when v_instagram_pilot is null then null else '••••' || right(v_instagram_pilot, 4)
    end,
    'messenger_pilot_masked', case
      when v_messenger_pilot is null then null else '••••' || right(v_messenger_pilot, 4)
    end
  );
end;
$function$;

revoke all on function public.admin_get_meta_inbox_connection_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_inbox_connection_summary(uuid)
to authenticated;

