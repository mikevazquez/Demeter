-- ASISTIAN · Signing Secret para Webhook entrante.
-- El secreto se guarda únicamente en Supabase Vault y nunca se devuelve al cliente.

create or replace function public.admin_set_asistian_signing_secret(
  target_studio_id uuid,
  target_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := trim(coalesce(target_secret, ''));
  v_secret_name text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if length(v_secret) < 12 then
    raise exception 'secret_invalid';
  end if;

  v_secret_name := 'asistian_signing_secret:' || target_studio_id::text;

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_secret,
      v_secret_name,
      'Studio Flow Asistian incoming webhook signing secret'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      v_secret_name,
      'Studio Flow Asistian incoming webhook signing secret'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_signing_secret(uuid,text)
from public, anon, service_role;

grant execute on function public.admin_set_asistian_signing_secret(uuid,text)
to authenticated;

create or replace function public.service_get_asistian_signing_secret(
  target_studio_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_name text;
  v_secret text;
begin
  v_secret_name := 'asistian_signing_secret:' || target_studio_id::text;

  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_secret;
end;
$$;

revoke all on function public.service_get_asistian_signing_secret(uuid)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_signing_secret(uuid)
to service_role;
