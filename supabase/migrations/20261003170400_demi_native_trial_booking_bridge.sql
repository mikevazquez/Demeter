create table if not exists public.assistant_reservation_links (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  assistant_conversation_id uuid references public.assistant_conversations(id) on delete set null,
  source text not null default 'assistant',
  created_at timestamptz not null default now(),
  unique (studio_id, reservation_id)
);

alter table public.assistant_reservation_links enable row level security;
revoke all on public.assistant_reservation_links from anon, authenticated;
grant all on public.assistant_reservation_links to service_role;

create or replace function public.assistant_ensure_trial_student(
  target_studio_id uuid,
  target_crm_contact_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_contact public.crm_contacts%rowtype;
  v_person public.persons%rowtype;
  v_student public.students%rowtype;
  v_phone text;
  v_email text;
  v_full_name text;
  v_student_id uuid;
begin
  if target_studio_id is null or target_crm_contact_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'students.write') then
    raise exception 'forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':assistant-contact:' || target_crm_contact_id::text,
      0
    )
  );

  select * into v_contact
  from public.crm_contacts
  where id=target_crm_contact_id
    and studio_id=target_studio_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','crm_contact_not_found');
  end if;

  select * into v_person
  from public.persons
  where id=v_contact.person_id
    and studio_id=target_studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','person_not_found');
  end if;

  if v_contact.converted_student_id is not null then
    select * into v_student
    from public.students
    where id=v_contact.converted_student_id
      and studio_id=target_studio_id;

    if found and v_student.active and v_student.lifecycle_status='active' then
      return jsonb_build_object(
        'ok',true,'created',false,'student_id',v_student.id,
        'student_type',v_student.student_type::text,'trial_status',v_student.trial_status::text
      );
    end if;
  end if;

  select * into v_student
  from public.students
  where studio_id=target_studio_id
    and person_id=v_person.id
    and lifecycle_status<>'archived'
  order by created_at asc
  limit 1
  for update;

  if found then
    if not v_student.active or v_student.lifecycle_status<>'active' then
      return jsonb_build_object('ok',false,'reason_code','student_not_operable');
    end if;

    update public.crm_contacts
    set converted_student_id=v_student.id,
        lifecycle_status=case when v_student.student_type='trial' then 'trial' else 'student' end,
        updated_at=now()
    where id=v_contact.id;

    return jsonb_build_object(
      'ok',true,'created',false,'student_id',v_student.id,
      'student_type',v_student.student_type::text,'trial_status',v_student.trial_status::text
    );
  end if;

  select pc.value into v_phone
  from public.person_contacts pc
  where pc.studio_id=target_studio_id
    and pc.person_id=v_person.id
    and pc.kind='phone'
  order by pc.is_primary desc,pc.created_at asc
  limit 1;

  if v_phone is null or v_phone !~ '^[+][1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'reason_code','phone_required');
  end if;

  if exists(
    select 1 from public.students s
    where s.studio_id=target_studio_id
      and s.phone=v_phone
      and s.person_id<>v_person.id
      and s.lifecycle_status<>'archived'
  ) then
    return jsonb_build_object('ok',false,'reason_code','phone_ambiguous');
  end if;

  select pc.value into v_email
  from public.person_contacts pc
  where pc.studio_id=target_studio_id
    and pc.person_id=v_person.id
    and pc.kind='email'
  order by pc.is_primary desc,pc.created_at asc
  limit 1;

  v_full_name := trim(
    v_person.first_name ||
    case when nullif(trim(coalesce(v_person.last_name,'')),'') is not null
      then ' ' || trim(v_person.last_name) else '' end
  );

  insert into public.students(
    studio_id,person_id,full_name,phone,email,active,lifecycle_status,
    profile_status,student_type,trial_status
  )
  values(
    target_studio_id,v_person.id,v_full_name,v_phone,
    nullif(lower(trim(coalesce(v_email,''))),''),
    true,'active','incomplete','trial','pending'
  )
  returning id into v_student_id;

  update public.students
  set profile_status=private.student_profile_status(v_student_id),updated_at=now()
  where id=v_student_id;

  update public.crm_contacts
  set lifecycle_status='trial',
      converted_student_id=v_student_id,
      source=coalesce(source,'assistant'),
      updated_at=now()
  where id=v_contact.id;

  return jsonb_build_object(
    'ok',true,'created',true,'student_id',v_student_id,
    'student_type','trial','trial_status','pending'
  );
end;
$function$;

create or replace function public.assistant_book_payment_pending(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid,
  target_assistant_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_existing public.reservations%rowtype;
  v_eligibility jsonb;
  v_reason text;
  v_credit_cost integer := 1;
  v_occupied integer := 0;
  v_reservation_id uuid;
begin
  if target_studio_id is null or target_session_id is null or target_student_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id and studio_id=target_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;
  if coalesce(v_session.requires_resource,false) then
    return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id and studio_id=target_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then
    return jsonb_build_object('ok',false,'reason_code','student_not_operable');
  end if;

  select * into v_existing
  from public.reservations
  where session_id=target_session_id and student_id=target_student_id
    and status in ('reserved','attended')
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok',true,'reused',true,'reservation_id',v_existing.id,
      'commercial_status',v_existing.commercial_status::text
    );
  end if;

  select count(*)::integer into v_occupied
  from public.reservations
  where session_id=target_session_id and status in ('reserved','attended');

  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  v_eligibility := private.booking_eligibility_core(target_session_id,target_student_id,false);

  if coalesce((v_eligibility->>'eligible')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'reason_code','package_coverage_available',
      'credit_cost',greatest(coalesce((v_eligibility->>'credit_cost')::integer,1),1)
    );
  end if;

  v_reason := coalesce(v_eligibility->>'reason_code','commercial_coverage_missing');
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer,1),1);

  if v_reason not in (
    'no_active_product','outside_product','outside_product_schedule',
    'no_credits','payment_pending','enrollment_required'
  ) then
    return jsonb_build_object('ok',false,'reason_code',v_reason,'credit_cost',v_credit_cost);
  end if;

  insert into public.reservations(
    studio_id,session_id,student_id,student_user_id,acquisition_id,
    status,credits_held,commercial_status
  )
  values(
    target_studio_id,target_session_id,target_student_id,v_student.user_id,null,
    'reserved',v_credit_cost,'payment_pending'
  )
  returning id into v_reservation_id;

  insert into public.assistant_reservation_links(
    studio_id,reservation_id,assistant_conversation_id,source
  )
  values(target_studio_id,v_reservation_id,target_assistant_conversation_id,'assistant')
  on conflict(studio_id,reservation_id) do nothing;

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'walkin.commercial_pending',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'walkin.commercial_pending:assistant:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'student_id',target_student_id,'session_id',target_session_id,
      'reason_code',v_reason,'credit_cost',v_credit_cost,
      'walkin',false,'source','assistant','commercial_pending',true
    )
  );

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'booking.created',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'booking.created:assistant:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'reservation_id',v_reservation_id,'session_id',target_session_id,
      'student_id',target_student_id,'acquisition_id',null,
      'credit_cost',v_credit_cost,'unlimited',false,
      'source','assistant','commercial_status','payment_pending'
    )
  );

  return jsonb_build_object(
    'ok',true,'reused',false,'reservation_id',v_reservation_id,
    'student_id',target_student_id,'session_id',target_session_id,
    'commercial_status','payment_pending','commercial_pending',true,
    'reason_code',v_reason,'credit_cost',v_credit_cost
  );
end;
$function$;

create or replace function private.assistant_enforce_payment_before_attendance()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status='attended'
     and coalesce(new.commercial_status::text,'')='payment_pending'
     and exists(
       select 1 from public.assistant_reservation_links l
       where l.studio_id=new.studio_id and l.reservation_id=new.id
     ) then
    raise exception 'assistant_payment_required';
  end if;
  return new;
end;
$function$;

drop trigger if exists assistant_enforce_payment_before_attendance on public.reservations;
create trigger assistant_enforce_payment_before_attendance
before insert or update of status,commercial_status
on public.reservations
for each row
execute function private.assistant_enforce_payment_before_attendance();

revoke all on function public.assistant_ensure_trial_student(uuid,uuid) from public;
revoke all on function public.assistant_book_payment_pending(uuid,uuid,uuid,uuid) from public;
grant execute on function public.assistant_ensure_trial_student(uuid,uuid) to authenticated,service_role;
grant execute on function public.assistant_book_payment_pending(uuid,uuid,uuid,uuid) to authenticated,service_role;
