-- Scoped phone editing for instructor profiles.  This operation requires instructors.write.
create or replace function public.admin_update_instructor_phone(
  p_instructor_id uuid, p_phone text
) returns void language plpgsql set search_path to '' as $$
declare v_studio_id uuid; v_person_id uuid; v_phone text;
begin
  select studio_id,person_id into v_studio_id,v_person_id
  from public.instructors where id=p_instructor_id;
  if v_studio_id is null
     or not private.has_capability(v_studio_id,'instructors.write') then
    raise exception 'forbidden';
  end if;
  v_phone:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
  if v_phone is not null and v_phone !~ '^52[0-9]{10}$' then
    raise exception 'phone_invalid';
  end if;
  if v_phone is null then
    delete from public.person_contacts
    where studio_id=v_studio_id and person_id=v_person_id and kind='phone';
  elsif exists(select 1 from public.person_contacts
               where studio_id=v_studio_id and person_id=v_person_id and kind='phone') then
    update public.person_contacts
    set value=v_phone,updated_at=now()
    where id=(select id from public.person_contacts
              where studio_id=v_studio_id and person_id=v_person_id and kind='phone'
              order by is_primary desc,created_at limit 1);
  else
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary)
    values(v_studio_id,v_person_id,'phone',v_phone,true);
  end if;
end $$;
