-- Limit student-CRM writers to student phone contacts.
-- Coach phone contacts are writable only by authorized Equipo managers.
alter policy person_contacts_student_staff_write on public.person_contacts
  using (private.has_capability(studio_id,'students.write')
    and (kind<>'phone' or phone_role='student'))
  with check (private.has_capability(studio_id,'students.write')
    and (kind<>'phone' or phone_role='student'));

-- Keep legacy instructor creation compatible with the role-scoped contact key.
CREATE OR REPLACE FUNCTION public.admin_create_instructor(p_first_name text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_bio text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_studio_id uuid; v_person_id uuid; v_instructor_id uuid;
begin
  select sm.studio_id into v_studio_id from public.studio_memberships sm where sm.user_id = auth.uid() and sm.active = true order by sm.created_at limit 1;
  if v_studio_id is null or not private.has_capability(v_studio_id, 'instructors.write') then raise exception 'forbidden'; end if;
  if nullif(trim(p_first_name), '') is null then raise exception 'first_name_required'; end if;
  insert into public.persons (studio_id, first_name, last_name) values (v_studio_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), '')) returning id into v_person_id;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then insert into public.person_contacts (studio_id, person_id, kind, value, is_primary, phone_role) values (v_studio_id, v_person_id, 'phone', trim(p_phone), true, 'coach'); end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null then insert into public.person_contacts (studio_id, person_id, kind, value, is_primary) values (v_studio_id, v_person_id, 'email', lower(trim(p_email)), true); end if;
  insert into public.instructors (studio_id, person_id, bio) values (v_studio_id, v_person_id, nullif(trim(coalesce(p_bio, '')), '')) returning id into v_instructor_id;
  return v_instructor_id;
end;
$function$;
