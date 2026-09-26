-- DEV-03D: make the default international phone calling code configurable per studio.

alter table public.studios
  add column if not exists phone_country_calling_code text not null default '+52';

do $$
begin
  alter table public.studios
    add constraint studios_phone_country_calling_code_format
    check (phone_country_calling_code ~ '^\+[1-9][0-9]{0,3}$');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.owner_update_studio_regional_settings_v2(
  p_studio_id uuid,
  p_timezone text,
  p_currency text,
  p_locale text,
  p_phone_country_calling_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_phone_country_calling_code text := btrim(coalesce(p_phone_country_calling_code,''));
begin
  if v_phone_country_calling_code !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'studio_phone_country_calling_code_invalid' using errcode='22023';
  end if;

  perform public.owner_update_studio_regional_settings(
    p_studio_id,
    p_timezone,
    p_currency,
    p_locale
  );

  update public.studios
  set phone_country_calling_code=v_phone_country_calling_code
  where id=p_studio_id;
end;
$function$;

revoke all on function public.owner_update_studio_regional_settings_v2(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.owner_update_studio_regional_settings_v2(uuid,text,text,text,text)
  to authenticated, service_role;

create or replace function public.service_provision_studio_v2(
  p_name text,
  p_slug text,
  p_timezone text,
  p_currency text,
  p_locale text,
  p_phone_country_calling_code text,
  p_primary_color text,
  p_owner_user_id uuid,
  p_owner_full_name text,
  p_owner_requires_activation boolean,
  p_site_name text,
  p_address text,
  p_space_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_phone_country_calling_code text := btrim(coalesce(p_phone_country_calling_code,''));
begin
  if v_phone_country_calling_code !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'phone_country_calling_code_invalid' using errcode='22023';
  end if;

  v_result := public.service_provision_studio(
    p_name,
    p_slug,
    p_timezone,
    p_currency,
    p_locale,
    p_primary_color,
    p_owner_user_id,
    p_owner_full_name,
    p_owner_requires_activation,
    p_site_name,
    p_address,
    p_space_name
  );

  update public.studios
  set phone_country_calling_code=v_phone_country_calling_code
  where id=(v_result->>'studio_id')::uuid;

  return v_result;
end;
$function$;

revoke all on function public.service_provision_studio_v2(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text
) from public, anon, authenticated;
grant execute on function public.service_provision_studio_v2(
  text,text,text,text,text,text,text,uuid,text,boolean,text,text,text
) to service_role;
