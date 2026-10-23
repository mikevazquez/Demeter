-- DEMI-PROS-03A · Decisions D-PAY-01/02/03 + Mike's clarification (2026-10-21 12:52):
-- a prospect can buy any package by bank transfer with Demi. Nothing about the person changes before
-- payment: preparing only records the pending purchase against the CRM contact. Once the receipt
-- matches the amount, Demi asks for full name, birth date and email; only then the profile is
-- registered, the student is created/linked, enrollment (paid or included) and package are activated
-- under the existing provisional-transfer rule, and the prospect becomes a student.

-- 1. Intents can belong to a prospect contact until the profile is completed.
alter table public.assistant_transfer_purchase_intents
  alter column student_id drop not null,
  add column if not exists crm_contact_id uuid references public.crm_contacts(id),
  add column if not exists profile_requested_at timestamptz,
  add column if not exists profile_completed_at timestamptz;

alter table public.assistant_transfer_purchase_intents
  drop constraint if exists assistant_transfer_purchase_intents_identity_check;
alter table public.assistant_transfer_purchase_intents
  add constraint assistant_transfer_purchase_intents_identity_check
  check (student_id is not null or crm_contact_id is not null);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.assistant_transfer_purchase_intents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.assistant_transfer_purchase_intents drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.assistant_transfer_purchase_intents
  add constraint assistant_transfer_purchase_intents_status_check check (status in (
    'awaiting_receipt','awaiting_profile','provisional_active','validated','rejected',
    'cancelled','expired','superseded'
  ));

drop index if exists public.assistant_transfer_purchase_one_open_per_conversation;
create unique index assistant_transfer_purchase_one_open_per_conversation
  on public.assistant_transfer_purchase_intents(studio_id, conversation_id)
  where status in ('awaiting_receipt','awaiting_profile','provisional_active');

-- 2. Quote shared by preview and prepare for a prospect (no student yet: no enrollment, no purchases).
create or replace function private.demi_prospect_transfer_quote(
  p_studio uuid, p_conversation uuid, p_contact uuid, p_product uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_product public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_person uuid;
begin
  if not exists(
    select 1 from public.assistant_conversations ac
    join public.crm_contacts cc on cc.id=p_contact and cc.studio_id=ac.studio_id
    where ac.id=p_conversation and ac.studio_id=p_studio and ac.student_id is null
      and ac.context->>'crm_contact_id'=p_contact::text
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  -- A person that already has a student profile buys through the student flow.
  select person_id into v_person from public.crm_contacts where id=p_contact and studio_id=p_studio;
  if v_person is not null and exists(
    select 1 from public.students where studio_id=p_studio and person_id=v_person and lifecycle_status<>'archived'
  ) then
    return jsonb_build_object('ok',false,'reason_code','student_profile_exists');
  end if;

  select * into v_product
  from public.product_templates
  where id=p_product and studio_id=p_studio and active
    and assistant_visible is distinct from false
    and reward_credit_wallet is distinct from true
    and product_type <> 'enrollment';
  if not found then return jsonb_build_object('ok',false,'reason_code','product_not_available'); end if;

  if not coalesce(v_product.enrollment_included,false) then
    select * into v_policy from public.enrollment_policies where studio_id=p_studio;
    if found and v_policy.enabled and v_policy.required_for_package_purchase then
      select * into v_enrollment_product
      from public.product_templates
      where id=v_policy.enrollment_product_template_id
        and studio_id=p_studio and active and product_type='enrollment';
      if not found then
        return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured');
      end if;
      return jsonb_build_object(
        'ok',true,'enrollment_required',true,
        'product_id',v_product.id,'enrollment_product_id',v_enrollment_product.id,
        'package',jsonb_build_object('name',v_product.name,'amount_minor',v_product.price_minor,
          'currency',v_product.currency,'enrollment_included',false),
        'enrollment',jsonb_build_object('name',v_enrollment_product.name,
          'amount_minor',v_enrollment_product.price_minor,'currency',v_enrollment_product.currency),
        'package_amount_minor',v_product.price_minor,
        'enrollment_amount_minor',v_enrollment_product.price_minor,
        'total_amount_minor',v_product.price_minor+v_enrollment_product.price_minor,
        'currency',v_product.currency
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,'enrollment_required',false,
    'product_id',v_product.id,'enrollment_product_id',null,
    'package',jsonb_build_object('name',v_product.name,'amount_minor',v_product.price_minor,
      'currency',v_product.currency,'enrollment_included',coalesce(v_product.enrollment_included,false)),
    'package_amount_minor',v_product.price_minor,
    'enrollment_amount_minor',null,
    'total_amount_minor',v_product.price_minor,
    'currency',v_product.currency
  );
end;
$function$;
revoke all on function private.demi_prospect_transfer_quote(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.service_preview_prospect_transfer_purchase(
  p_studio uuid, p_conversation uuid, p_contact uuid, p_product uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_quote jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  v_quote := private.demi_prospect_transfer_quote(p_studio,p_conversation,p_contact,p_product);
  return v_quote - 'product_id' - 'enrollment_product_id';
end;
$function$;
revoke all on function public.service_preview_prospect_transfer_purchase(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_preview_prospect_transfer_purchase(uuid,uuid,uuid,uuid) to service_role;

-- 3. Prepare: records ONLY the pending purchase for the contact. No person/student change.
create or replace function public.service_prepare_prospect_transfer_purchase(
  p_studio uuid, p_conversation uuid, p_contact uuid, p_session uuid, p_product uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_quote jsonb;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_intent uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));

  v_quote := private.demi_prospect_transfer_quote(p_studio,p_conversation,p_contact,p_product);
  if coalesce((v_quote->>'ok')::boolean,false) is not true then return v_quote; end if;

  if p_session is not null and not exists(
    select 1 from public.class_sessions where id=p_session and studio_id=p_studio and status='scheduled'
  ) then
    return jsonb_build_object('ok',false,'reason_code','session_not_available');
  end if;

  if exists(
    select 1 from public.assistant_transfer_purchase_intents
    where studio_id=p_studio and conversation_id=p_conversation and status in ('awaiting_profile','provisional_active')
  ) then
    return jsonb_build_object('ok',false,'reason_code','purchase_already_in_progress');
  end if;

  if not exists(
    select 1 from public.studio_payment_methods spm
    where spm.studio_id=p_studio and spm.active and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank from public.studio_bank_transfer_settings where studio_id=p_studio and enabled;
  if not found
     or nullif(trim(coalesce(v_bank.bank_name,'')),'') is null
     or nullif(trim(coalesce(v_bank.account_holder,'')),'') is null
     or (
       nullif(trim(coalesce(v_bank.clabe,'')),'') is null
       and nullif(trim(coalesce(v_bank.account_number,'')),'') is null
       and nullif(trim(coalesce(v_bank.card_number,'')),'') is null
     ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_details_not_configured');
  end if;

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=p_studio and conversation_id=p_conversation and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,crm_contact_id,session_id,product_template_id,
    amount_minor,currency,status,package_amount_minor,enrollment_product_template_id,enrollment_amount_minor
  ) values(
    p_studio,p_conversation,null,p_contact,p_session,(v_quote->>'product_id')::uuid,
    (v_quote->>'total_amount_minor')::integer,v_quote->>'currency','awaiting_receipt',
    (v_quote->>'package_amount_minor')::integer,
    nullif(v_quote->>'enrollment_product_id','')::uuid,
    nullif(v_quote->>'enrollment_amount_minor','')::integer
  ) returning id into v_intent;

  return jsonb_build_object(
    'ok',true,'status','awaiting_receipt','intent_id',v_intent,
    'package',v_quote->'package',
    'enrollment_required',(v_quote->>'enrollment_required')::boolean,
    'enrollment',v_quote->'enrollment',
    'total_amount_minor',(v_quote->>'total_amount_minor')::integer,
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,'instructions',v_bank.instructions
    ),
    'receipt_required',true,
    'profile_required_after_payment',true,
    'activation_rule','activate_after_matching_receipt_and_profile_pending_validation',
    'revocable_until_validated',true
  );
end;
$function$;
revoke all on function public.service_prepare_prospect_transfer_purchase(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_prepare_prospect_transfer_purchase(uuid,uuid,uuid,uuid,uuid) to service_role;

-- 4. Receipt matched: keep it with the intent and wait for the profile data.
create or replace function public.service_record_prospect_transfer_receipt(
  p_studio uuid, p_conversation uuid, p_contact uuid, p_intent uuid,
  p_event uuid, p_provider_message text, p_media text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_intent public.assistant_transfer_purchase_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  select * into v_intent
  from public.assistant_transfer_purchase_intents
  where id=p_intent and studio_id=p_studio and conversation_id=p_conversation
    and crm_contact_id=p_contact and student_id is null
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','pending_transfer_not_found'); end if;

  if v_intent.status='awaiting_profile' then
    return jsonb_build_object('ok',true,'status','awaiting_profile','intent_id',v_intent.id,'idempotent',true);
  end if;
  if v_intent.status<>'awaiting_receipt' then
    return jsonb_build_object('ok',false,'reason_code','transfer_not_awaiting_receipt');
  end if;
  if v_intent.expires_at<=clock_timestamp() then
    update public.assistant_transfer_purchase_intents set status='expired',updated_at=clock_timestamp() where id=v_intent.id;
    return jsonb_build_object('ok',false,'reason_code','transfer_intent_expired');
  end if;

  update public.assistant_transfer_purchase_intents
  set status='awaiting_profile',
      receipt_event_id=p_event,
      receipt_provider_message_id=p_provider_message,
      receipt_media_id=p_media,
      receipt_received_at=coalesce(receipt_received_at,clock_timestamp()),
      profile_requested_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=v_intent.id;

  return jsonb_build_object('ok',true,'status','awaiting_profile','intent_id',v_intent.id,
    'profile_fields',jsonb_build_array('full_name','birth_date','email'));
end;
$function$;
revoke all on function public.service_record_prospect_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_record_prospect_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- 5. Profile received: register everything and activate in one transaction.
create or replace function public.service_complete_prospect_transfer_purchase(
  p_studio uuid, p_conversation uuid, p_contact uuid,
  p_full_name text, p_birth_date date, p_email text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_intent public.assistant_transfer_purchase_intents%rowtype;
  v_contact public.crm_contacts%rowtype;
  v_name text := regexp_replace(trim(coalesce(p_full_name,'')),'\s+',' ','g');
  v_email text := lower(trim(coalesce(p_email,'')));
  v_today date;
  v_student uuid;
  v_definition uuid;
  v_ensure jsonb;
  v_activation jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text,0));

  select * into v_intent
  from public.assistant_transfer_purchase_intents
  where studio_id=p_studio and conversation_id=p_conversation and crm_contact_id=p_contact
    and student_id is null and status='awaiting_profile'
  order by created_at desc limit 1
  for update;
  if not found then
    -- Replay after success returns the completed purchase instead of repeating it.
    select * into v_intent
    from public.assistant_transfer_purchase_intents
    where studio_id=p_studio and conversation_id=p_conversation and crm_contact_id=p_contact
      and status in ('provisional_active','validated') and profile_completed_at is not null
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object('ok',true,'status',v_intent.status,'idempotent',true,
        'student_id',v_intent.student_id,'sale_id',v_intent.sale_id);
    end if;
    return jsonb_build_object('ok',false,'reason_code','payment_not_confirmed');
  end if;

  select (clock_timestamp() at time zone coalesce(s.timezone,'America/Mexico_City'))::date
  into v_today from public.studios s where s.id=p_studio;

  if v_name !~ '\S+\s+\S+' or length(v_name)>160 then
    return jsonb_build_object('ok',false,'reason_code','full_name_required');
  end if;
  if p_birth_date is null or p_birth_date>v_today or p_birth_date<v_today-interval '100 years' then
    return jsonb_build_object('ok',false,'reason_code','birth_date_invalid');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email)>254 then
    return jsonb_build_object('ok',false,'reason_code','email_invalid');
  end if;

  select * into v_contact from public.crm_contacts where id=p_contact and studio_id=p_studio for update;
  if not found or v_contact.person_id is null then
    return jsonb_build_object('ok',false,'reason_code','crm_contact_not_found');
  end if;

  -- The email must not belong to another person or student of this studio.
  if exists(
    select 1 from public.person_contacts pc
    where pc.studio_id=p_studio and pc.kind='email' and lower(pc.value)=v_email
      and pc.person_id<>v_contact.person_id
  ) or exists(
    select 1 from public.students st
    where st.studio_id=p_studio and lower(st.email)=v_email
      and st.person_id is distinct from v_contact.person_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','email_in_use');
  end if;

  update public.persons
  set first_name=split_part(v_name,' ',1),
      last_name=nullif(trim(substr(v_name,length(split_part(v_name,' ',1))+1)),''),
      updated_at=now()
  where id=v_contact.person_id and studio_id=p_studio;

  if not exists(
    select 1 from public.person_contacts
    where studio_id=p_studio and person_id=v_contact.person_id and kind='email' and lower(value)=v_email
  ) then
    insert into public.person_contacts(studio_id,person_id,kind,value,is_primary)
    values(p_studio,v_contact.person_id,'email',v_email,
      not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=v_contact.person_id and kind='email'));
  end if;

  v_ensure := public.assistant_ensure_trial_student(p_studio,p_contact);
  if coalesce((v_ensure->>'ok')::boolean,false) is not true then
    raise exception 'student_profile_unavailable:%',coalesce(v_ensure->>'reason_code','unknown');
  end if;
  v_student := (v_ensure->>'student_id')::uuid;

  update public.students
  set full_name=v_name,email=v_email,updated_at=now()
  where id=v_student and studio_id=p_studio;

  select id into v_definition
  from public.profile_field_definitions
  where studio_id=p_studio and entity_type='student' and key='birth_date' and active
  limit 1;
  if v_definition is not null then
    insert into public.profile_field_values(definition_id,person_id,studio_id,value)
    values(v_definition,v_contact.person_id,p_studio,to_jsonb(p_birth_date::text))
    on conflict(definition_id,person_id) do update set value=excluded.value,updated_at=now();
  end if;

  update public.assistant_conversations
  set student_id=v_student,
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object('identity_needs_name',false)
  where id=p_conversation and studio_id=p_studio;

  -- Hand the intent to the existing activation (package, credits, paid or included enrollment).
  update public.assistant_transfer_purchase_intents
  set student_id=v_student,status='awaiting_receipt',
      expires_at=greatest(expires_at,clock_timestamp()+interval '1 hour'),
      profile_completed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_intent.id;

  v_activation := public.service_activate_transfer_receipt(
    p_studio,p_conversation,v_student,v_intent.receipt_event_id,
    v_intent.receipt_provider_message_id,v_intent.receipt_media_id
  );
  if coalesce((v_activation->>'ok')::boolean,false) is not true then
    -- Roll back profile and student changes; the intent stays awaiting_profile for human review.
    raise exception 'transfer_activation_failed:%',coalesce(v_activation->>'reason_code','unknown');
  end if;

  update public.crm_contacts
  set converted_student_id=v_student,lifecycle_status='student',updated_at=now()
  where id=p_contact and studio_id=p_studio;

  return jsonb_build_object(
    'ok',true,'status','provisional_active','student_id',v_student,
    'activation',v_activation,'revocable_until_validated',true
  );
end;
$function$;
revoke all on function public.service_complete_prospect_transfer_purchase(uuid,uuid,uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.service_complete_prospect_transfer_purchase(uuid,uuid,uuid,text,date,text) to service_role;
