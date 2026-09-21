-- SF-255B1 · Confirm existing contact identity before invitation when names differ

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

  if target_guest_phone !~ '^\+[1-9][0-9]{7,14}$' then
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
    and lower(pc.value)=lower(target_guest_phone)
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

create or replace function public.student_guest_invitation_contact_identity(
  target_guest_person_id uuid
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

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select * into v_person
  from public.persons
  where id=target_guest_person_id
    and studio_id=v_student.studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','contact_not_found');
  end if;

  select * into v_crm
  from public.crm_contacts
  where studio_id=v_student.studio_id
    and person_id=v_person.id;

  return jsonb_build_object(
    'ok',true,
    'person_id',v_person.id,
    'display_name',trim(concat_ws(' ',v_person.first_name,v_person.last_name)),
    'lifecycle_status',coalesce(v_crm.lifecycle_status,'trial')
  );
end;
$$;

revoke all on function public.student_guest_invitation_contact_identity(uuid)
from public,anon;
grant execute on function public.student_guest_invitation_contact_identity(uuid)
to authenticated;

create or replace function public.student_create_guest_invitation_existing(
  target_host_reservation_id uuid,
  target_guest_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_person public.persons%rowtype;
  v_phone text;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
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

  select * into v_person
  from public.persons
  where id=target_guest_person_id
    and studio_id=v_student.studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','contact_not_found');
  end if;

  select pc.value into v_phone
  from public.person_contacts pc
  where pc.studio_id=v_student.studio_id
    and pc.person_id=v_person.id
    and pc.kind='phone'
  order by pc.is_primary desc, pc.created_at asc
  limit 1;

  if v_phone is null then
    return jsonb_build_object('ok',false,'reason_code','guest_phone_invalid');
  end if;

  v_name:=trim(concat_ws(' ',v_person.first_name,v_person.last_name));

  return public.student_create_guest_invitation(
    target_host_reservation_id,
    v_name,
    v_phone
  );
end;
$$;

revoke all on function public.student_create_guest_invitation_existing(uuid,uuid)
from public,anon;
grant execute on function public.student_create_guest_invitation_existing(uuid,uuid)
to authenticated;
