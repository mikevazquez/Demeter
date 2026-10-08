-- Explicit tenant selection: an owner can belong to multiple studios.
-- The former admin_create_instructor chose the first membership, regardless
-- of the studio selected in the admin portal.
create or replace function public.admin_create_instructor_scoped(
  p_studio_id uuid,
  p_first_name text,
  p_last_name text default null,
  p_phone text default null,
  p_email text default null,
  p_bio text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_person_id uuid; v_instructor_id uuid;
begin
  if (select auth.uid()) is null
     or p_studio_id is null
     or not private.has_capability(p_studio_id,'instructors.write') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if nullif(trim(p_first_name),'') is null then
    raise exception 'first_name_required' using errcode='22023';
  end if;

  insert into public.persons(studio_id,first_name,last_name)
  values(p_studio_id,trim(p_first_name),nullif(trim(coalesce(p_last_name,'')),''))
  returning id into v_person_id;

  if nullif(trim(coalesce(p_phone,'')),'') is not null then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary)
    values(p_studio_id,v_person_id,'phone',trim(p_phone),true);
  end if;
  if nullif(trim(coalesce(p_email,'')),'') is not null then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary)
    values(p_studio_id,v_person_id,'email',lower(trim(p_email)),true);
  end if;

  insert into public.instructors(studio_id,person_id,bio)
  values(p_studio_id,v_person_id,nullif(trim(coalesce(p_bio,'')),''))
  returning id into v_instructor_id;
  return v_instructor_id;
end;
$$;
revoke all on function public.admin_create_instructor_scoped(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.admin_create_instructor_scoped(uuid,text,text,text,text,text) to authenticated;
