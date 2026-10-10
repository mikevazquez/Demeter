-- A typed phone is a search claim, never authentication to an existing profile.
create table public.demi_identity_link_audit (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 identity_id uuid not null references public.assistant_channel_identities(id),
 handoff_id uuid not null unique references public.assistant_handoffs(id),
 previous_person_id uuid references public.persons(id), person_id uuid not null references public.persons(id),
 student_id uuid references public.students(id), verified_by uuid not null references auth.users(id),
 verification_method text not null check(verification_method in ('in_person','verified_whatsapp','existing_portal')),
 verification_note text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.demi_identity_link_audit enable row level security;
revoke all on public.demi_identity_link_audit from public,anon,authenticated,service_role;
grant select on public.demi_identity_link_audit to authenticated,service_role;
create policy demi_identity_audit_staff_read on public.demi_identity_link_audit for select to authenticated
 using(private.has_capability(studio_id,'students.read'));

create function public.service_identify_demi_meta_contact(p_studio uuid,p_conversation uuid,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.assistant_conversations%rowtype; i public.assistant_channel_identities%rowtype;
 digits text; v_phone text; candidates jsonb; h jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio and channel in ('facebook_messenger','instagram') for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','meta_conversation_required'); end if;
 select * into i from public.assistant_channel_identities where studio_id=p_studio and id::text=c.context->>'identity_id'
  and provider=c.channel and provider_account_id=c.context->>'provider_account_id' and provider_contact_id=c.context->>'provider_contact_id' for update;
 if not found or c.external_thread_ref is distinct from i.provider_account_id||':'||i.provider_contact_id then
  return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if c.student_id is not null and i.student_id=c.student_id then return jsonb_build_object('ok',true,'identity_verified',true,'already_identified',true); end if;
 if length(coalesce(p_phone,''))>32 or coalesce(p_phone,'') !~ '^[+() 0-9-]+$' then return jsonb_build_object('ok',false,'reason_code','phone_requires_ten_digits'); end if;
 digits:=regexp_replace(p_phone,'[^0-9]','','g');
 if length(digits)=12 and left(digits,2)='52' then digits:=substr(digits,3);
 elsif length(digits)=13 and left(digits,3)='521' then digits:=substr(digits,4); end if;
 if digits !~ '^[0-9]{10}$' or digits ~ '^([0-9])\1{9}$' then return jsonb_build_object('ok',false,'reason_code','phone_requires_ten_digits'); end if;
 v_phone:='+52'||digits;
 select coalesce(jsonb_agg(to_jsonb(matches.person_id)),'[]'::jsonb) into candidates from (
  select pc.person_id from public.person_contacts pc where pc.studio_id=p_studio and pc.kind='phone' and pc.value=v_phone
  union select st.person_id from public.students st where st.studio_id=p_studio and st.phone=v_phone and st.person_id is not null and st.lifecycle_status<>'archived'
 ) matches;
 if jsonb_array_length(candidates)>0 then
  h:=public.assistant_create_handoff(p_studio,p_conversation,null,'technical_block','Verificar identidad del canal antes de vincular una ficha o usar créditos. Un celular escrito no autentica a su titular.');
  if coalesce((h->>'ok')::boolean,false) then
   update public.assistant_handoffs set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('identity_verification',jsonb_build_object('identity_id',i.id,'claimed_phone',v_phone,'candidate_person_ids',candidates))
    where id::text=h->>'handoff_id' and studio_id=p_studio and conversation_id=c.id;
  end if;
  return jsonb_build_object('ok',false,'reason_code','identity_verification_required','human_review_created',coalesce((h->>'ok')::boolean,false),'handoff_id',h->>'handoff_id');
 end if;
 if i.metadata->>'claimed_phone' is not null and i.metadata->>'claimed_phone'<>v_phone then return jsonb_build_object('ok',false,'reason_code','claimed_phone_changed_requires_review'); end if;
 update public.assistant_channel_identities set metadata=metadata||jsonb_build_object('claimed_phone',v_phone,'minimal_identification_completed',true,'phone_authentication_verified',false),updated_at=clock_timestamp() where id=i.id;
 update public.assistant_conversations set context=context||jsonb_build_object('minimal_identification_completed',true),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('ok',true,'minimal_identification_completed',true,'identity_verified',false,'profile_created',false,'request_full_booking_data',false);
end; $$;
revoke all on function public.service_identify_demi_meta_contact(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_identify_demi_meta_contact(uuid,uuid,text) to service_role;

create function public.service_check_demi_minimal_identity(p_studio uuid,p_conversation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.assistant_conversations%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where studio_id=p_studio and id=p_conversation;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 if c.channel in ('facebook_messenger','instagram') and c.student_id is null and not coalesce((c.context->>'minimal_identification_completed')::boolean,false) then
  return jsonb_build_object('ok',false,'reason_code','minimal_phone_identification_required','request_phone_only',true); end if;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.service_check_demi_minimal_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_check_demi_minimal_identity(uuid,uuid) to service_role;

create function public.admin_verify_demi_channel_identity(p_studio uuid,p_handoff uuid,p_person uuid,p_method text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.assistant_handoffs%rowtype; c public.assistant_conversations%rowtype; i public.assistant_channel_identities%rowtype;
 contact uuid; student uuid; n integer; person uuid;
begin
 if auth.uid() is null or not private.has_capability(p_studio,'students.write') then raise exception 'forbidden'; end if;
 if p_method not in ('in_person','verified_whatsapp','existing_portal') or length(trim(coalesce(p_note,'')))<10 or length(p_note)>2000 then
  return jsonb_build_object('ok',false,'reason_code','verification_evidence_required'); end if;
 select * into h from public.assistant_handoffs where id=p_handoff and studio_id=p_studio for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','handoff_not_found'); end if;
 if exists(select 1 from public.demi_identity_link_audit where handoff_id=h.id and person_id=p_person and studio_id=p_studio) then return jsonb_build_object('ok',true,'idempotent',true); end if;
 if h.status<>'open' or h.assigned_to is distinct from auth.uid() then return jsonb_build_object('ok',false,'reason_code','claim_identity_case_first'); end if;
 if not coalesce(h.context#>'{identity_verification,candidate_person_ids}','[]'::jsonb) @> jsonb_build_array(p_person) then return jsonb_build_object('ok',false,'reason_code','identity_candidate_mismatch'); end if;
 select * into c from public.assistant_conversations where id=h.conversation_id and studio_id=p_studio and channel in ('facebook_messenger','instagram') for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select * into i from public.assistant_channel_identities where studio_id=p_studio and id::text=c.context->>'identity_id' and id::text=h.context#>>'{identity_verification,identity_id}'
  and provider=c.channel and provider_account_id=c.context->>'provider_account_id' and provider_contact_id=c.context->>'provider_contact_id' for update;
 if not found or c.external_thread_ref is distinct from i.provider_account_id||':'||i.provider_contact_id then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if c.student_id is not null or i.student_id is not null then return jsonb_build_object('ok',false,'reason_code','identity_already_linked'); end if;
 if exists(select 1 from public.demi_group_bookings where studio_id=p_studio and conversation_id=c.id)
  or exists(select 1 from public.assistant_pending_actions where studio_id=p_studio and conversation_id=c.id and status in ('pending','executed')) then
  return jsonb_build_object('ok',false,'reason_code','financial_operation_requires_review'); end if;
 select id into person from public.persons where id=p_person and studio_id=p_studio;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_candidate_mismatch'); end if;
 if not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person and kind='phone' and value=h.context#>>'{identity_verification,claimed_phone}')
  and not exists(select 1 from public.students where studio_id=p_studio and person_id=person and phone=h.context#>>'{identity_verification,claimed_phone}' and lifecycle_status<>'archived') then
  return jsonb_build_object('ok',false,'reason_code','identity_candidate_changed'); end if;
 select count(*) into n from public.students where studio_id=p_studio and person_id=person and lifecycle_status<>'archived';
 if n>1 then return jsonb_build_object('ok',false,'reason_code','multiple_student_profiles_require_review'); end if;
 select id into student from public.students where studio_id=p_studio and person_id=person and lifecycle_status<>'archived';
 select id into contact from public.crm_contacts where studio_id=p_studio and person_id=person;
 if contact is null then
  insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source) values(p_studio,person,'prospect','demi_identity_verification') returning id into contact; end if;
 insert into public.demi_identity_link_audit(studio_id,conversation_id,identity_id,handoff_id,previous_person_id,person_id,student_id,verified_by,verification_method,verification_note)
  values(p_studio,c.id,i.id,h.id,i.person_id,person,student,auth.uid(),p_method,trim(p_note));
 update public.assistant_channel_identities set person_id=person,student_id=student,crm_contact_id=contact,
  metadata=metadata||jsonb_build_object('phone_authentication_verified',true,'identity_verified_by',auth.uid(),'identity_verified_at',clock_timestamp()),updated_at=clock_timestamp() where id=i.id;
 update public.assistant_conversations set student_id=student,context=context||jsonb_build_object('crm_contact_id',contact,'minimal_identification_completed',true,'verified_student_link',student is not null),updated_at=clock_timestamp() where id=c.id;
 update public.crm_conversations set crm_contact_id=contact,student_id=student where id=c.crm_conversation_id and studio_id=p_studio;
 update public.demi_followups set state='cancelled',reason_code='identity_verified',lease_token=null,lease_until=null where studio_id=p_studio and conversation_id=c.id and state in ('pending','processing');
 return jsonb_build_object('ok',true,'identity_verified',true,'student_linked',student is not null,'profile_created',false,'human_case_remains_open',true);
end; $$;
revoke all on function public.admin_verify_demi_channel_identity(uuid,uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.admin_verify_demi_channel_identity(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.service_prepare_demi_group(p_studio uuid,p_conversation uuid,p_session uuid,p_count integer,p_transfer_count integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; price integer; curr text; n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if p_count not between 1 and 10 or p_transfer_count not between 1 and p_count then return jsonb_build_object('ok',false,'reason_code','invalid_count'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.session_id<>p_session or g.participant_count<>p_count or g.transfer_count<>p_transfer_count then return jsonb_build_object('ok',false,'reason_code','group_already_pending'); end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'idempotent',true);
 end if;
 -- A retry of a completed group recovers the existing receipt and current reservations, never a new charge.
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and session_id=p_session and participant_count=p_count and transfer_count=p_transfer_count and status in ('provisional','validated') order by created_at desc limit 1 for update;
 if found then
  select count(*) into n from public.demi_group_participants gp join public.reservations r on r.id=gp.reservation_id and r.studio_id=p_studio where gp.group_id=g.id and r.status='reserved';
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',g.participant_count,'reserved_count',n,'reservation_confirmed',n=g.participant_count,'receipt_received',true,'payment_required',false,'payment_validation_required',g.status='provisional','existing_group_requires_review',n<>g.participant_count,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then return jsonb_build_object('ok',false,'reason_code','group_resource_selection_required'); end if;
 if c.capacity-(select count(*) from public.reservations where session_id=c.id and status in ('reserved','attended'))<p_count then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
 select drop_in_price_minor into price from public.class_templates where id=c.template_id and studio_id=p_studio;
 select currency into curr from public.studios where id=p_studio;
 if coalesce(price,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency)
 values(p_studio,p_conversation,p_session,p_count,p_transfer_count,price*p_transfer_count,curr) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'reservation_confirmed',false);
end; $$;

create or replace function public.service_prepare_demi_prospect_payment(p_studio uuid,p_conversation uuid,p_contact uuid,p_session uuid,p_resource uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity_check jsonb; c public.class_sessions%rowtype; g public.demi_group_bookings%rowtype; preview jsonb; amount integer; curr text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 identity_check:=public.service_check_demi_minimal_identity(p_studio,p_conversation);
 if not coalesce((identity_check->>'ok')::boolean,false) then return identity_check; end if;
 if not exists(select 1 from public.assistant_conversations ac join public.crm_contacts cc on cc.id=p_contact and cc.studio_id=ac.studio_id where ac.id=p_conversation and ac.studio_id=p_studio and ac.student_id is null and ac.context->>'crm_contact_id'=p_contact::text) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));
 select * into g from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_receipt','awaiting_participants','partial') for update;
 if found then
  if g.session_id<>p_session or g.prospect_contact_id is distinct from p_contact or g.resource_id is distinct from p_resource then return jsonb_build_object('ok',false,'reason_code','payment_already_pending'); end if;
  return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'idempotent',true);
 end if;
 select * into c from public.class_sessions where id=p_session and studio_id=p_studio for update;
 if not found or c.status<>'scheduled' or c.starts_at<=clock_timestamp()+interval '30 minutes' then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 if c.requires_resource then
  if p_resource is null then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  if not exists(select 1 from public.session_resources sr join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id where sr.studio_id=p_studio and sr.session_id=p_session and sr.resource_id=p_resource and sr.enabled and r.active and coalesce(sr.capacity_override,c.resource_uses_per_item,1)>(select count(*) from public.reservation_resource_assignments ra where ra.studio_id=p_studio and ra.session_id=p_session and ra.resource_id=p_resource and ra.released_at is null)) then return jsonb_build_object('ok',false,'reason_code','resource_not_available'); end if;
 elsif p_resource is not null then return jsonb_build_object('ok',false,'reason_code','resource_not_required'); end if;
 preview:=public.assistant_trial_booking_preview(p_studio,p_session,null,p_contact);
 if not coalesce((preview->>'eligible')::boolean,false) then return preview||jsonb_build_object('ok',false); end if;
 amount:=coalesce((preview->>'amount_minor')::integer,(select drop_in_price_minor from public.class_templates where id=c.template_id and studio_id=p_studio));
 select currency into curr from public.studios where id=p_studio;
 if coalesce(amount,0)<=0 then return jsonb_build_object('ok',false,'reason_code','price_not_configured'); end if;
 insert into public.demi_group_bookings(studio_id,conversation_id,session_id,participant_count,transfer_count,amount_minor,currency,prospect_contact_id,resource_id) values(p_studio,p_conversation,p_session,1,1,amount,curr,p_contact,p_resource) returning * into g;
 return jsonb_build_object('ok',true,'group_id',g.id,'status',g.status,'amount_minor',g.amount_minor,'currency',g.currency,'participant_count',1,'reservation_confirmed',false);
end; $$;
