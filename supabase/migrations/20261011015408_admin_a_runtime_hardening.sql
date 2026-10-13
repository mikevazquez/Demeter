CREATE OR REPLACE FUNCTION public.owner_update_studio_business_profile_v1(p_studio_id uuid, p_contact_phone text, p_contact_email text, p_website_url text, p_location_name text, p_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_website text := nullif(btrim(coalesce(p_website_url, '')), '');
  v_location_name text := coalesce(nullif(btrim(coalesce(p_location_name, '')), ''), 'Principal');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_location_id uuid;
begin
  if not private.has_capability(p_studio_id,'settings.write') then
    raise exception 'studio_owner_required' using errcode='42501';
  end if;

  if v_phone is not null and length(v_phone) > 40 then
    raise exception 'studio_contact_phone_invalid' using errcode='22023';
  end if;

  if v_email is not null and (
    length(v_email) > 160
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'studio_contact_email_invalid' using errcode='22023';
  end if;

  if v_website is not null and (
    length(v_website) > 300
    or v_website !~* '^https?://'
  ) then
    raise exception 'studio_website_url_invalid' using errcode='22023';
  end if;

  if length(v_location_name) > 100 then
    raise exception 'studio_location_name_invalid' using errcode='22023';
  end if;

  if v_address is not null and length(v_address) > 500 then
    raise exception 'studio_address_invalid' using errcode='22023';
  end if;

  update public.studios
  set contact_phone = v_phone,
      contact_email = v_email,
      website_url = v_website
  where id = p_studio_id;

  select id
    into v_location_id
  from public.studio_locations
  where studio_id = p_studio_id
    and is_primary = true
  order by created_at asc
  limit 1
  for update;

  if v_location_id is null then
    insert into public.studio_locations(
      studio_id,
      name,
      address,
      active,
      is_primary
    )
    values (
      p_studio_id,
      v_location_name,
      v_address,
      true,
      true
    )
    returning id into v_location_id;
  else
    update public.studio_locations
    set name = v_location_name,
        address = v_address,
        active = true
    where id = v_location_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', v_location_id
  );
end;
$function$
;
revoke all on function public.owner_update_studio_business_profile_v1(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.owner_update_studio_business_profile_v1(uuid,text,text,text,text,text) to authenticated;
