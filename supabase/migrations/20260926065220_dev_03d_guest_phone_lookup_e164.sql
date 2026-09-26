-- DEV-03D: make guest contact lookup country-neutral while keeping canonical E.164 storage.

create or replace function public.student_guest_invitation_contact_lookup(
  target_guest_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_crm public.crm_contacts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_guest_phone !~ E'^\\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'reason_code','guest_phone_invalid');
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select p.* into v_person
  from public.person_contacts pc
  join public.persons p
    on p.id=pc.person_id
   and p.studio_id=pc.studio_id
  where pc.studio_id=v_student.studio_id
    and pc.kind='phone'
    and case
      when btrim(pc.value) like '+%' then
        '+' || regexp_replace(pc.value,'[^0-9]','','g')
      else
        (
          select st.phone_country_calling_code
          from public.studios st
          where st.id=v_student.studio_id
        ) || regexp_replace(pc.value,'[^0-9]','','g')
    end = target_guest_phone
  order by pc.is_primary desc, pc.created_at asc
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'found',false);
  end if;

  select * into v_crm
  from public.crm_contacts
  where studio_id=v_student.studio_id
    and person_id=v_person.id;

  return jsonb_build_object(
    'ok',true,
    'found',true,
    'person_id',v_person.id,
    'display_name',trim(concat_ws(' ',v_person.first_name,v_person.last_name)),
    'lifecycle_status',coalesce(v_crm.lifecycle_status,'trial')
  );
end;
$function$;
