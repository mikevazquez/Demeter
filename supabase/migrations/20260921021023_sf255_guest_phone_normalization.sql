-- SF-255B1 · Normalize guest phones from 10 local digits to Mexico E.164.
-- The portal supplies +52XXXXXXXXXX internally while lookup remains compatible with legacy +521 values.

create or replace function public.student_guest_invitation_contact_lookup(
  target_guest_phone text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_crm public.crm_contacts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_guest_phone !~ '^\+52[0-9]{10}$' then
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
    and right(regexp_replace(pc.value,'[^0-9]','','g'),10)
      = right(regexp_replace(target_guest_phone,'[^0-9]','','g'),10)
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
$$;

revoke all on function public.student_guest_invitation_contact_lookup(text)
from public,anon;
grant execute on function public.student_guest_invitation_contact_lookup(text)
to authenticated;
