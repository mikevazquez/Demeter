-- Workshop-only participant profiles reuse the existing non-regular identity
-- bridge. This never purchases enrollment, trial credits, packages or Auth.
create table private.demi_workshop_participant_registrations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  conversation_id uuid not null references public.assistant_conversations(id),
  turn_id uuid not null references public.assistant_turns(id),
  offer_id uuid not null references public.workshop_offers(id),
  contact_id uuid not null references public.crm_contacts(id),
  student_id uuid not null references public.students(id),
  full_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(studio_id,conversation_id), unique(studio_id,turn_id)
);
alter table private.demi_workshop_participant_registrations enable row level security;
revoke all on private.demi_workshop_participant_registrations from public,anon,authenticated,service_role;

create function public.service_register_demi_workshop_participant(
  p_studio uuid,p_conversation uuid,p_offer uuid,p_turn uuid,p_full_name text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.assistant_conversations%rowtype;
  contact public.crm_contacts%rowtype;
  person public.persons%rowtype;
  identity public.assistant_channel_identities%rowtype;
  previous private.demi_workshop_participant_registrations%rowtype;
  name text:=regexp_replace(btrim(coalesce(p_full_name,'')),'\s+',' ','g');
  message text;
  v_phone text;
  sender text;
  registered jsonb;
  student uuid;
begin
  if auth.role() is distinct from 'service_role'
    or not exists(select 1 from public.studios where id=p_studio and status='active')
  then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled)
  then raise exception 'workshop_demi_disabled'; end if;
  select * into c from public.assistant_conversations
    where studio_id=p_studio and id=p_conversation and assistant_key='demi' and status='open' for update;
  if not found then raise exception 'conversation_identity_mismatch'; end if;
  select * into previous from private.demi_workshop_participant_registrations
    where studio_id=p_studio and conversation_id=c.id;
  if found then
    if c.student_id is distinct from previous.student_id then raise exception 'conversation_identity_mismatch'; end if;
    if previous.turn_id=p_turn and (previous.full_name<>name or previous.offer_id<>p_offer)
    then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('ok',true,'student_id',previous.student_id,'profile_registered',true,
      'replayed',true,'reservation_confirmed',false,'payment_verified',false);
  end if;
  if c.student_id is not null then
    if not exists(select 1 from public.students where id=c.student_id and studio_id=p_studio and active and lifecycle_status='active')
    then raise exception 'student_not_operable'; end if;
    return jsonb_build_object('ok',true,'student_id',c.student_id,'profile_registered',true,
      'replayed',true,'reservation_confirmed',false,'payment_verified',false);
  end if;
  if not exists(select 1 from public.workshop_offers o
    left join public.workshop_studio_policies policy on policy.studio_id=o.studio_id
    where o.studio_id=p_studio and o.id=p_offer
      and not coalesce(o.requires_enrollment,policy.requires_enrollment,false)
      and exists(select 1 from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
        where os.offer_id=o.id and s.studio_id=p_studio and s.assistant_visible and s.status::text='scheduled' and s.starts_at>now()))
  then raise exception 'guest_offer_unavailable'; end if;
  select content into message from public.assistant_turns
    where id=p_turn and studio_id=p_studio and conversation_id=c.id and role='user' and direction='inbound' and content !~ '[?¿]';
  if message is null or name !~ '\S+\s+\S+' or length(name)>160
    or position(translate(lower(name),'áéíóúü','aeiouu') in
      translate(lower(regexp_replace(message,'\s+',' ','g')),'áéíóúü','aeiouu'))=0
  then raise exception 'full_name_required'; end if;
  if not exists(select 1 from public.assistant_turns t where t.studio_id=p_studio and t.conversation_id=c.id
    and t.role='user' and t.direction='inbound'
    and t.created_at between now()-interval '24 hours' and (select created_at from public.assistant_turns where id=p_turn)
    and translate(lower(t.content),'áéíóúü','aeiouu') ~ '(inscrib|apunt|anot|registr|dar.*alta|alta.*taller|quiero.*(taller|workshop|masterclass|evento))'
    and t.content !~ '[?¿]'
    and translate(lower(t.content),'áéíóúü','aeiouu') !~ '\mno\M.*(quiero|inscrib|apunt|registr|taller)')
  then raise exception 'workshop_registration_not_requested'; end if;
  select cc.* into contact from public.crm_contacts cc
    join public.crm_conversations rc on rc.id=c.crm_conversation_id and rc.studio_id=p_studio and rc.crm_contact_id=cc.id
    where cc.studio_id=p_studio and cc.id::text=c.context->>'crm_contact_id';
  if not found or contact.person_id is null then raise exception 'conversation_identity_mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio::text||':assistant-contact:'||contact.id::text,0));
  select * into contact from public.crm_contacts where studio_id=p_studio and id=contact.id for update;
  select * into person from public.persons where studio_id=p_studio and id=contact.person_id for update;
  if not found then raise exception 'conversation_identity_mismatch'; end if;
  if c.channel='whatsapp' then
    v_phone:=c.context->>'contact_phone';
    sender:=regexp_replace(coalesce(c.external_thread_ref,''),'[^0-9]','','g');
    if length(sender)=13 and left(sender,3)='521' then sender:='52'||substr(sender,4); end if;
    if v_phone is null or v_phone<>'+'||sender or v_phone !~ '^[+][1-9][0-9]{7,14}$'
      or not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person.id and kind='phone' and value=v_phone)
    then raise exception 'conversation_identity_mismatch'; end if;
  elsif c.channel in ('facebook_messenger','instagram') then
    select * into identity from public.assistant_channel_identities
      where studio_id=p_studio and id::text=c.context->>'identity_id' and provider=c.channel
        and provider_account_id=c.context->>'provider_account_id' and provider_contact_id=c.context->>'provider_contact_id'
        and person_id=person.id and crm_contact_id=contact.id and student_id is null for update;
    if not found or c.external_thread_ref is distinct from identity.provider_account_id||':'||identity.provider_contact_id
      or not coalesce((identity.metadata->>'minimal_identification_completed')::boolean,false)
    then raise exception 'minimal_phone_identification_required'; end if;
    v_phone:=identity.metadata->>'claimed_phone';
    if v_phone is null or v_phone !~ '^[+]52[0-9]{10}$' then raise exception 'minimal_phone_identification_required'; end if;
  else raise exception 'conversation_identity_mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio::text||':workshop-phone:'||v_phone,0));
  if contact.converted_student_id is not null
    or exists(select 1 from public.students s where s.studio_id=p_studio and (s.person_id=person.id or s.phone=v_phone))
    or exists(select 1 from public.person_contacts pc where pc.studio_id=p_studio and pc.kind='phone' and pc.value=v_phone and pc.person_id<>person.id)
  then raise exception 'identity_verification_required'; end if;
  if not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person.id and kind='phone' and value=v_phone) then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(p_studio,person.id,'phone',v_phone,true);
  end if;
  update public.persons set first_name=split_part(name,' ',1),last_name=btrim(substr(name,length(split_part(name,' ',1))+1)),updated_at=now()
    where id=person.id and studio_id=p_studio;
  registered:=public.assistant_ensure_trial_student(p_studio,contact.id);
  if registered->>'ok' is distinct from 'true' or registered->>'created' is distinct from 'true'
  then raise exception 'participant_profile_unavailable'; end if;
  student:=(registered->>'student_id')::uuid;
  update public.students set acquisition_source='demi_workshop_guest',trial_status=null,updated_at=now()
    where id=student and studio_id=p_studio and student_type='trial';
  if not found then raise exception 'participant_profile_unavailable'; end if;
  update public.assistant_conversations set student_id=student,
    context=context||jsonb_build_object('identity_needs_name',false,'workshop_guest',true),updated_at=now() where id=c.id;
  update public.crm_conversations set student_id=student where id=c.crm_conversation_id and studio_id=p_studio;
  if identity.id is not null then
    update public.assistant_channel_identities set student_id=student,
      metadata=metadata||jsonb_build_object('workshop_guest',true),updated_at=now() where id=identity.id and studio_id=p_studio;
  end if;
  insert into private.demi_workshop_participant_registrations(studio_id,conversation_id,turn_id,offer_id,contact_id,student_id,full_name)
    values(p_studio,c.id,p_turn,p_offer,contact.id,student,name);
  return jsonb_build_object('ok',true,'student_id',student,'profile_registered',true,'replayed',false,
    'reservation_confirmed',false,'payment_verified',false);
end $$;
revoke all on function public.service_register_demi_workshop_participant(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_register_demi_workshop_participant(uuid,uuid,uuid,uuid,text) to service_role;
