-- Configure Meta messaging channels independently; preserve existing secret values.
create or replace function public.admin_set_meta_inbox_connection(
  target_studio_id uuid,
  target_page_access_token text,
  target_page_id text,
  target_instagram_access_token text,
  target_instagram_user_id text,
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
  v_secret_name text := 'meta_inbox_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_existing text;
  v_payload jsonb := '{}'::jsonb;
  v_page_access_token text := trim(coalesce(target_page_access_token, ''));
  v_page_id text := trim(coalesce(target_page_id, ''));
  v_instagram_access_token text := trim(coalesce(target_instagram_access_token, ''));
  v_instagram_user_id text := trim(coalesce(target_instagram_user_id, ''));
  v_graph_api_version text := trim(coalesce(target_graph_api_version, ''));
  v_app_secret text := trim(coalesce(target_app_secret, ''));
  v_verify_token text := trim(coalesce(target_verify_token, ''));
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_page_access_token <> '' and (length(v_page_access_token) < 20 or length(v_page_access_token) > 8192) then
    raise exception 'meta_page_access_token_invalid';
  end if;
  if v_page_id <> '' and v_page_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_page_id_invalid';
  end if;
  if v_instagram_access_token <> '' and (length(v_instagram_access_token) < 20 or length(v_instagram_access_token) > 8192) then
    raise exception 'meta_instagram_access_token_invalid';
  end if;
  if v_instagram_user_id <> '' and v_instagram_user_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_instagram_user_id_invalid';
  end if;
  if v_graph_api_version !~ '^v[0-9]+\.[0-9]+$' then
    raise exception 'meta_graph_api_version_invalid';
  end if;
  if v_app_secret <> '' and (length(v_app_secret) < 16 or length(v_app_secret) > 512) then
    raise exception 'meta_app_secret_invalid';
  end if;


  select s.id, s.decrypted_secret
    into v_secret_id, v_existing
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_existing is not null and pg_input_is_valid(v_existing, 'jsonb') then
    v_payload := v_existing::jsonb;
    if jsonb_typeof(v_payload) <> 'object' then
      v_payload := '{}'::jsonb;
    end if;
  end if;

  -- Never rotate an established webhook verification token when saving another channel.
  if v_verify_token = '' then
    v_verify_token := coalesce(nullif(v_payload->>'verify_token', ''), '');
  end if;
  if v_verify_token = '' then
    v_verify_token := replace(gen_random_uuid()::text, '-', '') ||
                      replace(gen_random_uuid()::text, '-', '');
  end if;
  if length(v_verify_token) < 16 or length(v_verify_token) > 128
     or v_verify_token !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'meta_verify_token_invalid';
  end if;

  if (v_page_access_token = '') <> (v_page_id = '') then raise exception 'meta_page_credentials_incomplete'; end if;
  if (v_instagram_access_token = '') <> (v_instagram_user_id = '') then raise exception 'meta_instagram_credentials_incomplete'; end if;
  if v_page_access_token = '' and v_instagram_access_token = ''
     and coalesce(v_payload->>'page_access_token', '') = ''
     and coalesce(v_payload->>'instagram_access_token', '') = '' then
    raise exception 'meta_channel_credentials_required';
  end if;
  if v_app_secret = '' and coalesce(v_payload->>'app_secret', '') = '' then raise exception 'meta_app_secret_invalid'; end if;
  v_payload := v_payload || jsonb_build_object(
    'page_access_token', coalesce(nullif(v_page_access_token, ''), v_payload->>'page_access_token', ''),
    'page_id', coalesce(nullif(v_page_id, ''), v_payload->>'page_id', ''),
    'instagram_access_token', coalesce(nullif(v_instagram_access_token, ''), v_payload->>'instagram_access_token', ''),
    'instagram_user_id', coalesce(nullif(v_instagram_user_id, ''), v_payload->>'instagram_user_id', ''),
    'graph_api_version', v_graph_api_version,
    'app_secret', coalesce(nullif(v_app_secret, ''), v_payload->>'app_secret', ''),
    'verify_token', v_verify_token,
    'pilot_contact_ids', case
      when jsonb_typeof(v_payload->'pilot_contact_ids') = 'object' then v_payload->'pilot_contact_ids'
      else jsonb_build_object('instagram', '[]'::jsonb, 'facebook_messenger', '[]'::jsonb)
    end
  );

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      v_secret_name,
      'Studio Flow Meta Inbox connection for Instagram and Facebook Messenger'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      v_secret_name,
      'Studio Flow Meta Inbox connection for Instagram and Facebook Messenger'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'connected', true,
    'page_id', v_payload->>'page_id',
    'instagram_user_id', v_payload->>'instagram_user_id',
    'verify_token', v_verify_token
  );
end;
$function$;

revoke all on function public.admin_set_meta_inbox_connection(
  uuid,text,text,text,text,text,text,text
) from public, anon, service_role;
grant execute on function public.admin_set_meta_inbox_connection(
  uuid,text,text,text,text,text,text,text
) to authenticated;

