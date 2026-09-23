-- ASISTIAN · Credenciales firmadas por automatización.
-- Cada Webhook entrante de Asistian tiene su propia URL y secreto de firma.

create or replace function public.admin_set_asistian_webhook_credentials(
  target_studio_id uuid,
  target_template text,
  target_url text,
  target_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text := trim(coalesce(target_template, ''));
  v_url text := trim(coalesce(target_url, ''));
  v_secret text := trim(coalesce(target_secret, ''));
  v_url_name text;
  v_signing_secret_name text;
  v_vault_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    raise exception 'template_not_allowed';
  end if;

  if v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'url_invalid';
  end if;

  if length(v_secret) < 12 then
    raise exception 'secret_invalid';
  end if;

  v_url_name := 'asistian_webhook:' || target_studio_id::text || ':' || v_template;
  v_signing_secret_name :=
    'asistian_signing_secret:' || target_studio_id::text || ':' || v_template;

  select s.id
    into v_vault_id
  from vault.secrets s
  where s.name = v_url_name
  limit 1;

  if v_vault_id is null then
    perform vault.create_secret(
      v_url,
      v_url_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  else
    perform vault.update_secret(
      v_vault_id,
      v_url,
      v_url_name,
      'Studio Flow Asistian incoming webhook: ' || v_template
    );
  end if;

  v_vault_id := null;

  select s.id
    into v_vault_id
  from vault.secrets s
  where s.name = v_signing_secret_name
  limit 1;

  if v_vault_id is null then
    perform vault.create_secret(
      v_secret,
      v_signing_secret_name,
      'Studio Flow Asistian incoming webhook signing secret: ' || v_template
    );
  else
    perform vault.update_secret(
      v_vault_id,
      v_secret,
      v_signing_secret_name,
      'Studio Flow Asistian incoming webhook signing secret: ' || v_template
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_webhook_credentials(uuid,text,text,text)
from public, anon, service_role;

grant execute on function public.admin_set_asistian_webhook_credentials(uuid,text,text,text)
to authenticated;

create or replace function public.service_get_asistian_signing_secret(
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
  v_secret text;
begin
  if v_template not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    return null;
  end if;

  v_secret_name :=
    'asistian_signing_secret:' || target_studio_id::text || ':' || v_template;

  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_secret;
end;
$$;

revoke all on function public.service_get_asistian_signing_secret(uuid,text)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_signing_secret(uuid,text)
to service_role;
