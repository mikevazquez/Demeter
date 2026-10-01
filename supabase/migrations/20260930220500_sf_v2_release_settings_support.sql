-- Studio Flow V2 release support: branding and regional settings only.
-- Deliberately isolated from authentication, memberships, subscription access and session handling.

alter table public.studios
  add column if not exists tagline text null,
  add column if not exists phone_country_calling_code text not null default '+52';

do $$
begin
  alter table public.studios
    add constraint studios_v2_release_tagline_length_chk
    check (tagline is null or length(tagline) <= 120);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.studios
    add constraint studios_v2_release_phone_calling_code_chk
    check (phone_country_calling_code ~ '^\+[1-9][0-9]{0,3}$');
exception when duplicate_object then null;
end $$;

create or replace function public.owner_update_studio_portal_branding_v2_release(
  p_studio_id uuid,
  p_name text,
  p_logo_path text,
  p_tagline text,
  p_primary_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := btrim(coalesce(p_name,''));
  v_logo text := nullif(btrim(coalesce(p_logo_path,'')),'');
  v_tagline text := nullif(btrim(coalesce(p_tagline,'')),'');
  v_color text := upper(btrim(coalesce(p_primary_color,'')));
begin
  if not exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id = p_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active = true
      and sm.role::text = 'owner'
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'studio_name_invalid' using errcode='22023';
  end if;
  if v_tagline is not null and length(v_tagline) > 120 then
    raise exception 'studio_tagline_invalid' using errcode='22023';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'studio_primary_color_invalid' using errcode='22023';
  end if;
  if v_logo is not null and (
    length(v_logo) > 500 or split_part(v_logo,'/',1) <> p_studio_id::text
  ) then
    raise exception 'studio_logo_path_invalid' using errcode='22023';
  end if;

  update public.studios
  set name = v_name,
      logo_path = v_logo,
      tagline = v_tagline,
      primary_color = v_color
  where id = p_studio_id;
end;
$function$;

create or replace function public.owner_update_studio_regional_settings_v2_release(
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
  v_timezone text := btrim(coalesce(p_timezone,''));
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_locale text := btrim(coalesce(p_locale,''));
  v_phone text := btrim(coalesce(p_phone_country_calling_code,''));
begin
  if not exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id = p_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active = true
      and sm.role::text = 'owner'
  ) then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'studio_timezone_invalid' using errcode='22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'studio_currency_invalid' using errcode='22023';
  end if;
  if length(v_locale) < 2 or length(v_locale) > 20 then
    raise exception 'studio_locale_invalid' using errcode='22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{0,3}$' then
    raise exception 'studio_phone_country_calling_code_invalid' using errcode='22023';
  end if;

  update public.studios
  set timezone = v_timezone,
      currency = v_currency,
      locale = v_locale,
      phone_country_calling_code = v_phone
  where id = p_studio_id;
end;
$function$;

revoke all on function public.owner_update_studio_portal_branding_v2_release(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.owner_update_studio_portal_branding_v2_release(uuid,text,text,text,text)
  to authenticated;

revoke all on function public.owner_update_studio_regional_settings_v2_release(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.owner_update_studio_regional_settings_v2_release(uuid,text,text,text,text)
  to authenticated;
