-- ASISTIAN-INBOUND-02
-- Backward-compatible receiver secret lookup.
-- Production already has the legacy incoming Asistian secret; prefer the new
-- dedicated receiver key when configured, otherwise reuse the legacy key.

create or replace function public.service_get_asistian_to_studio_signing_secret(
  target_studio_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = 'asistian_to_studio_signing_secret:' || target_studio_id::text
  limit 1;

  if v_secret is null then
    select s.decrypted_secret
      into v_secret
    from vault.decrypted_secrets s
    where s.name = 'asistian_signing_secret:' || target_studio_id::text
    limit 1;
  end if;

  return v_secret;
end;
$$;

revoke all on function public.service_get_asistian_to_studio_signing_secret(uuid)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_to_studio_signing_secret(uuid)
to service_role;
