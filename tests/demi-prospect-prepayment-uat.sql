-- Sandbox-only integration UAT. Every synthetic write is rolled back.
-- Do not execute in production. Scoped to the isolated Billing UAT tenant.
begin;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
do $uat$
declare
  fixture_studio uuid := '086b590c-43de-4e44-bae1-bf0fb15ece45';
  studio uuid := gen_random_uuid();
  student uuid := gen_random_uuid();
  conversation uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  session_id uuid;
  intent uuid;
  reservation uuid;
  first_result jsonb;
  replay jsonb;
  blocked jsonb;
  outcomes jsonb := '[]';
begin
  if not exists (select 1 from public.studios where id=fixture_studio and slug='studio-flow-billing-uat') then
    raise exception 'Isolated UAT tenant missing';
  end if;
  if exists (select 1 from public.reservations where studio_id=fixture_studio) then
    raise exception 'UAT tenant must have no prior reservations';
  end if;
  select id into session_id from public.class_sessions
    where studio_id=fixture_studio and status='scheduled' and starts_at>clock_timestamp()
    order by starts_at limit 1;
  if session_id is null then raise exception 'Synthetic upcoming session missing'; end if;
  -- A transaction-only tenant without the incomplete draft SaaS assignment.
  -- Reuse only the source tenant's synthetic schedule; rollback restores all
  -- ownership. No triggers, RLS or operational validation are disabled.
  insert into public.studios(id,name,slug) values(studio,'Demi UAT temporal','demi-uat-'||studio);
  update public.class_templates set studio_id=studio where studio_id=fixture_studio;
  update public.studio_locations set studio_id=studio where studio_id=fixture_studio;
  update public.class_sessions set studio_id=studio where id=session_id;
  insert into public.students(id,studio_id,full_name,student_type)
    values(student,studio,'UAT Prospecto Transferencia Ficticio','trial');
  insert into public.assistant_conversations(id,studio_id,student_id,channel,context)
    values(conversation,studio,student,'internal_demo','{"uat":"transactional_prospect_prepayment"}');
  insert into public.product_templates(id,studio_id,name,product_type,price_minor,currency,active,assistant_visible,credit_limit,validity_days)
    values(product,studio,'UAT primera clase — no vender','other',15000,'MXN',false,false,1,1);
  insert into public.trial_booking_policies
    select (jsonb_populate_record(null::public.trial_booking_policies,
      to_jsonb(p)||jsonb_build_object('studio_id',studio,'require_payment_before_booking',true,
        'trial_payment_product_template_id',product))).*
    from public.trial_booking_policies p where p.studio_id=fixture_studio;
  insert into public.studio_bank_transfer_settings(studio_id,enabled,bank_name,account_holder,account_number)
    values(studio,true,'BANCO FICTICIO UAT — NO TRANSFERIR','PRUEBA SIN VALOR','0000');
  insert into public.studio_payment_methods(studio_id,code,name,category,active)
    values(studio,'bank_transfer','Transferencia ficticia UAT','transfer',true)
    on conflict (studio_id,code) do update set active=true;
  first_result := public.service_prepare_trial_transfer(studio,conversation,student,session_id,null);
  if coalesce((first_result->>'ok')::boolean,false) is not true then
    raise exception 'prepare failed: %',first_result;
  end if;
  intent := (first_result->>'intent_id')::uuid;
  if exists(select 1 from public.reservations where studio_id=studio) then
    raise exception 'Reservation created before receipt';
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','prepare_without_booking','passed',true));
  insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,
    phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint)
    values(event_id,studio,'meta_whatsapp','uat-'||event_id,'internal_demo',
      'internal_demo:'||student,'image','uat-media','uat-fingerprint');
  blocked := public.service_activate_trial_transfer_receipt(studio,conversation,student,intent,event_id,'uat-'||event_id,'uat-media');
  if blocked->>'reason_code'<>'receipt_amount_not_matched' then
    raise exception 'Unmatched receipt not blocked: %',blocked;
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','unmatched_receipt_blocked','passed',true));
  blocked := public.service_activate_trial_transfer_receipt(studio,conversation,gen_random_uuid(),intent,event_id,'uat-'||event_id,'uat-media');
  if blocked->>'reason_code'<>'pending_transfer_not_found' then
    raise exception 'Receipt crossed student identity: %',blocked;
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','cross_identity_blocked','passed',true));
  update public.assistant_transfer_purchase_intents set expires_at=clock_timestamp()-interval '1 minute' where id=intent;
  blocked := public.service_activate_trial_transfer_receipt(studio,conversation,student,intent,event_id,'uat-'||event_id,'uat-media');
  if blocked->>'reason_code'<>'transfer_intent_expired' then
    raise exception 'Expired transfer accepted: %',blocked;
  end if;
  update public.assistant_transfer_purchase_intents set status='awaiting_receipt',expires_at=clock_timestamp()+interval '30 minutes' where id=intent;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','expired_receipt_blocked','passed',true));
  update public.assistant_transfer_purchase_intents set receipt_amount_matches=true,
    receipt_detected_amount_minor=15000,receipt_detected_currency='MXN',receipt_read_confidence=0.99,
    receipt_storage_path='UAT/receipt-not-an-actual-upload.png' where id=intent;
  first_result := public.service_activate_trial_transfer_receipt(studio,conversation,student,intent,event_id,'uat-'||event_id,'uat-media');
  if coalesce((first_result->>'ok')::boolean,false) is not true then
    raise exception 'activation failed: %',first_result;
  end if;
  reservation := (first_result->>'reservation_id')::uuid;
  if first_result->>'status'<>'provisional_active' or first_result->>'payment_validation_required'<>'true' then
    raise exception 'Missing provisional review: %',first_result;
  end if;
  if not exists(select 1 from public.sales where id=(first_result->>'sale_id')::uuid
    and studio_id=studio and pending_access_exception=true) then
    raise exception 'Pending transfer not visible to team';
  end if;
  if exists(select 1 from public.payments where studio_id=studio) then
    raise exception 'Payment incorrectly settled';
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','provisional_booking_pending_review','passed',true));
  replay := public.service_activate_trial_transfer_receipt(studio,conversation,student,intent,event_id,'uat-'||event_id,'uat-media');
  if replay->>'idempotent'<>'true' or (replay->>'reservation_id')::uuid<>reservation
    or (select count(*) from public.reservations where studio_id=studio)<>1
    or (select count(*) from public.sales where studio_id=studio)<>1 then
    raise exception 'Duplicate receipt created duplicate booking or sale: %',replay;
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','duplicate_receipt_idempotent','passed',true));
  blocked := public.service_activate_trial_transfer_receipt(studio,conversation,student,intent,event_id,'uat-different','uat-media');
  if blocked->>'reason_code'<>'transfer_already_has_receipt' then
    raise exception 'Second receipt not rejected: %',blocked;
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','second_receipt_blocked','passed',true));
  student := gen_random_uuid();
  conversation := gen_random_uuid();
  insert into public.students(id,studio_id,full_name,student_type)
    values(student,studio,'UAT Prospecto Sin Cupo','trial');
  insert into public.assistant_conversations(id,studio_id,student_id,channel)
    values(conversation,studio,student,'internal_demo');
  update public.class_sessions set capacity=1 where id=session_id;
  blocked := public.service_prepare_trial_transfer(studio,conversation,student,session_id,null);
  if blocked->>'reason_code'<>'session_full' then
    raise exception 'Full session offered for payment: %',blocked;
  end if;
  outcomes := outcomes || jsonb_build_array(jsonb_build_object('case','full_session_blocked','passed',true));
  perform set_config('uat.demi_result',outcomes::text,true);
end;
$uat$;
select current_setting('uat.demi_result')::jsonb as uat_results;
rollback;
