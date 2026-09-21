-- SF-174 · Asistian webhook configuration in Supabase Vault.
-- Stores only approved inbound webhook URLs and exposes reads exclusively to service_role.

create or replace function public.admin_set_asistian_webhook(
  target_studio_id uuid,
  target_template text,
  target_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_url text := trim(coalesce(target_url, ''));
  v_secret_name text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted'
  ) then
    raise exception 'template_not_allowed';
  end if;

  if v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'url_invalid';
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_url,
      v_secret_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_webhook(uuid,text,text)
from public, anon, service_role;

grant execute on function public.admin_set_asistian_webhook(uuid,text,text)
to authenticated;

create or replace function public.service_get_asistian_webhook(
  target_studio_id uuid,
  target_template text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_secret_name text;
  v_url text;
begin
  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted'
  ) then
    return null;
  end if;

  v_secret_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret
    into v_url
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_url;
end;
$$;

revoke all on function public.service_get_asistian_webhook(uuid,text)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_webhook(uuid,text)
to service_role;
