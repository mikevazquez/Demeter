create or replace function public.student_update_own_profile(target_first_name text, target_last_name text default null, target_email text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_email text:=nullif(lower(trim(coalesce(target_email,''))),'');
  v_contact_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'email_invalid'; end if;

  select s.* into v_student from public.students s
  where s.user_id=(select auth.uid()) and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc limit 1;
  if not found or v_student.person_id is null then raise exception 'student_context_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'student.profile.self') then raise exception 'forbidden'; end if;

  select p.* into v_person
  from public.persons p
  where p.id=v_student.person_id and p.studio_id=v_student.studio_id;
  if not found then raise exception 'student_context_not_found'; end if;

  select pc.id into v_contact_id
  from public.person_contacts pc
  where pc.person_id=v_student.person_id and pc.studio_id=v_student.studio_id and pc.kind='email'
  order by pc.is_primary desc,pc.created_at asc
  limit 1;

  if v_email is null then
    if v_contact_id is not null then delete from public.person_contacts where id=v_contact_id; end if;
  elsif v_contact_id is null then
    insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
    values(v_student.person_id,v_student.studio_id,'email',v_email,true);
  else
    update public.person_contacts set value=v_email,is_primary=true,updated_at=now() where id=v_contact_id;
  end if;

  update public.students
  set email=v_email,updated_at=now()
  where id=v_student.id;

  return jsonb_build_object(
    'ok',true,
    'full_name',trim(concat_ws(' ',v_person.first_name,v_person.last_name)),
    'email',v_email,
    'phone',v_student.phone
  );
end;
$$;

revoke all on function public.student_update_own_profile(text,text,text) from public,anon;
grant execute on function public.student_update_own_profile(text,text,text) to authenticated;
