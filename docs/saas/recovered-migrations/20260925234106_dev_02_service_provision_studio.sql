
create or replace function public.service_provision_studio(
  p_name text,
  p_slug text,
  p_timezone text,
  p_currency text,
  p_locale text,
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
set search_path=''
as $$
declare
  v_studio_id uuid;
  v_site_id uuid;
  v_location_id uuid;
  v_space_id uuid;
begin
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'studio_name_required'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'studio_slug_invalid'; end if;
  if p_owner_user_id is null then raise exception 'owner_user_required'; end if;
  if nullif(trim(coalesce(p_owner_full_name,'')),'') is null then raise exception 'owner_name_required'; end if;
  if nullif(trim(coalesce(p_site_name,'')),'') is null then raise exception 'site_name_required'; end if;
  if nullif(trim(coalesce(p_space_name,'')),'') is null then raise exception 'space_name_required'; end if;
  if p_primary_color is null or p_primary_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'primary_color_invalid'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'currency_invalid'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'timezone_invalid';
  end if;
  if not exists (select 1 from auth.users where id=p_owner_user_id) then
    raise exception 'owner_auth_user_not_found';
  end if;

  insert into public.studios(name,slug,timezone,currency,locale,primary_color,status)
  values(
    trim(p_name),
    p_slug,
    p_timezone,
    p_currency,
    coalesce(nullif(trim(p_locale),''),'es-MX'),
    upper(p_primary_color),
    'active'
  )
  returning id into v_studio_id;

  insert into public.sites(studio_id,name,address,active)
  values(v_studio_id,trim(p_site_name),nullif(trim(coalesce(p_address,'')),''),true)
  returning id into v_site_id;

  insert into public.studio_locations(studio_id,name,address,active)
  values(v_studio_id,trim(p_site_name),nullif(trim(coalesce(p_address,'')),''),true)
  returning id into v_location_id;

  insert into public.spaces(studio_id,site_id,name,active)
  values(v_studio_id,v_site_id,trim(p_space_name),true)
  returning id into v_space_id;

  insert into public.profiles(id,full_name)
  values(p_owner_user_id,trim(p_owner_full_name))
  on conflict(id) do update
    set full_name=case
      when nullif(trim(coalesce(public.profiles.full_name,'')),'') is null
        then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at=now();

  insert into public.user_accounts(id,status,must_change_password)
  values(p_owner_user_id,'active',coalesce(p_owner_requires_activation,true))
  on conflict(id) do update
    set status='active',
        updated_at=now();

  insert into public.studio_memberships(studio_id,user_id,role,active,person_id)
  values(v_studio_id,p_owner_user_id,'owner',true,null);

  return jsonb_build_object(
    'studio_id',v_studio_id,
    'site_id',v_site_id,
    'location_id',v_location_id,
    'space_id',v_space_id,
    'owner_user_id',p_owner_user_id
  );
exception
  when unique_violation then
    if exists(select 1 from public.studios where slug=p_slug) then
      raise exception 'studio_slug_exists';
    end if;
    raise;
end;
$$;

revoke all on function public.service_provision_studio(
  text,text,text,text,text,text,uuid,text,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.service_provision_studio(
  text,text,text,text,text,text,uuid,text,boolean,text,text,text
) to service_role;
