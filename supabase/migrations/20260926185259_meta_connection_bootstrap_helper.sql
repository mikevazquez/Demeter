
create or replace function public.service_store_meta_connection_once(
  target_secret_name text,
  target_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(target_secret_name),'') = '' then
    raise exception 'invalid_secret_name';
  end if;
  if jsonb_typeof(target_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;

  select id into v_id
  from vault.secrets
  where name = target_secret_name
  limit 1;

  if v_id is null then
    perform vault.create_secret(
      target_payload::text,
      target_secret_name,
      'Demeter direct Meta WhatsApp Cloud API connection'
    );
  else
    perform vault.update_secret(
      v_id,
      target_payload::text,
      target_secret_name,
      'Demeter direct Meta WhatsApp Cloud API connection'
    );
  end if;
  return true;
end;
$$;

revoke all on function public.service_store_meta_connection_once(text,jsonb)
from public, anon, authenticated;

grant execute on function public.service_store_meta_connection_once(text,jsonb)
to service_role;
