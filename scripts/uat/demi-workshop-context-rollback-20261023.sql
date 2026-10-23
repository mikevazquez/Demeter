-- Sandbox hedouonyhynuvwbckdlg ONLY. Privileged setup, real DB role contexts.
-- No Auth records created/read, browser login, model, OCR, transport or real money.
-- All synthetic rows, claims and role changes roll back in the inner subtransaction.
do $test$
declare
 st uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); student uuid:=gen_random_uuid();
 actor uuid; discipline uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid(); template uuid:=gen_random_uuid();
 sessions uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; c uuid:=gen_random_uuid();
 prepared uuid:=gen_random_uuid(); accepted uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
 intent jsonb; held jsonb; purchase jsonb; result jsonb; h uuid; reservation uuid;
 tested integer:=0;
 guest_person uuid:=gen_random_uuid(); guest_contact uuid:=gen_random_uuid(); guest_crm uuid:=gen_random_uuid();
 guest_c uuid:=gen_random_uuid(); guest_request uuid:=gen_random_uuid(); guest_name_turn uuid:=gen_random_uuid();
 guest_accept uuid:=gen_random_uuid(); guest_event uuid:=gen_random_uuid(); guest_student uuid;
begin
 select id into actor from public.user_accounts where status='active' order by id limit 1;
 if actor is null then raise exception 'active_account_fixture_required'; end if;
 begin
  insert into public.studios(id,name,slug) values(st,'Synthetic workshop rollback','workshop-rollback-'||st);
  -- Synthetic, rolled-back SaaS entitlement; no billing provider is contacted.
  insert into public.studio_plan_assignments(studio_id,plan_id,status,trial_ends_at,metadata)
   select st,id,'trialing',now()+interval '1 day','{"fixture":"workshop-rollback"}'::jsonb from public.saas_plans where active order by id limit 1;
  insert into public.studio_module_overrides(studio_id,module_key,enabled)
   select distinct st,module_key,true from public.saas_module_capabilities where capability_key in ('schedule.read','schedule.write','sales.read','sales.write','students.read');
  insert into public.studio_memberships(studio_id,user_id,role) values(st,actor,'owner');
  insert into public.persons(id,studio_id,first_name,last_name) values(person,st,'Synthetic','Workshop');
  insert into public.students(id,studio_id,person_id,full_name) values(student,st,person,'Synthetic Workshop');
  insert into public.disciplines(id,studio_id,name) values(discipline,st,'Synthetic discipline');
  insert into public.workshop_studio_policies(studio_id,demi_enabled) values(st,true);
  insert into public.studio_payment_methods(studio_id,code,name,active) values(st,'bank_transfer','Transferencia sintética',true),(st,'cash','Efectivo sintético',true) on conflict do nothing;
  insert into public.studio_bank_transfer_settings(studio_id,enabled,bank_name,account_holder,instructions) values(st,true,'Synthetic bank','No real recipient','DO NOT PAY: rollback fixture');
  insert into public.workshop_offers(id,studio_id,title,full_price_minor,allow_individual_sessions,requires_enrollment,deposit_mode,deposit_value,overdue_mode,grace_minutes)
   values(offer,st,'Synthetic completion rollback',60000,true,false,'percent',50,'keep_and_notify',60);
  insert into public.class_templates(id,studio_id,discipline_id,name,duration_minutes,capacity,workshop_offer_id)
   values(template,st,discipline,'Synthetic owned dates',60,2,offer);
  for i in 1..2 loop
   insert into public.class_sessions(id,studio_id,template_id,starts_at,ends_at,capacity,assistant_visible)
    values(sessions[i],st,template,now()+make_interval(days=>80+i),now()+make_interval(days=>80+i,hours=>1),2,true);
   insert into public.workshop_offer_sessions values(offer,sessions[i],15000);
  end loop;
  insert into public.assistant_conversations(id,studio_id,student_id,channel) values(c,st,student,'whatsapp');
  insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content) values(prepared,st,c,'inbound','user','Quiero el taller completo');
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  execute 'set local role service_role';
  intent:=public.service_prepare_demi_workshop_purchase(st,c,offer,sessions,'full',prepared);
  if intent->>'amount_minor'<>'30000' or intent->>'confirmation_required'<>'true' then raise exception 'quote_mismatch'; end if;
  if public.service_prepare_demi_workshop_purchase(st,c,offer,sessions,'full',prepared)->>'intent_id' is distinct from intent->>'intent_id' then raise exception 'quote_replay_failed'; end if;
  result:=public.service_demi_workshop_context(st,c);
  if result->>'enabled'<>'true' or result#>>'{current_purchase,status}'<>'quoted' or result#>>'{current_purchase,payment_verified}'<>'false' then raise exception 'context_quote_mismatch'; end if;
  tested:=tested+1;
  execute 'reset role'; tested:=tested+1;
  if exists(select 1 from public.workshop_provisional_holds where studio_id=st) or exists(select 1 from public.payments where studio_id=st) then raise exception 'premature_effect'; end if;
  tested:=tested+1;
  insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content) values(accepted,st,c,'inbound','user','Sí acepto');
  execute 'set local role service_role';
  result:=public.service_accept_demi_workshop_purchase(st,c,accepted);
  if result->>'capacity_held'<>'false' or result->>'payment_verified'<>'false' then raise exception 'acceptance_effect'; end if;
  result:=public.service_demi_workshop_context(st,c);
  if result#>>'{current_purchase,status}'<>'receipt_required' then raise exception 'context_acceptance_mismatch'; end if;
  tested:=tested+1;
  execute 'reset role'; tested:=tested+1;
  insert into public.assistant_whatsapp_events(id,studio_id,assistant_conversation_id,provider_event_id,phone_number_id,message_type,payload_fingerprint)
   values(event,st,c,'synthetic:'||event,'synthetic-no-provider','image','synthetic-no-transport');
  execute 'set local role service_role';
  held:=public.service_record_demi_workshop_receipt(st,c,(intent->>'intent_id')::uuid,event,'synthetic:'||event,st||'/workshop/'||(intent->>'intent_id')||'/'||repeat('a',64),repeat('a',64),30000,'MXN',0.99);
  h:=(held->>'hold_id')::uuid;
  if h is null or held->>'payment_verified'<>'false' then raise exception 'hold_mismatch'; end if;
  if public.service_record_demi_workshop_receipt(st,c,(intent->>'intent_id')::uuid,event,'synthetic:'||event,st||'/workshop/'||(intent->>'intent_id')||'/'||repeat('a',64),repeat('a',64),30000,'MXN',0.99)->>'replayed'<>'true' then raise exception 'receipt_replay_failed'; end if;
  result:=public.service_demi_workshop_context(st,c);
  if result#>>'{current_purchase,status}'<>'reserved_provisionally' or result#>>'{current_purchase,payment_verified}'<>'false' or result#>>'{current_purchase,reservation_confirmed}'<>'false' then raise exception 'context_provisional_mismatch'; end if;
  tested:=tested+1;
  execute 'reset role'; tested:=tested+1;
  if exists(select 1 from public.payments where studio_id=st) or exists(select 1 from public.workshop_purchases where studio_id=st) then raise exception 'unverified_receipt_posted_money'; end if;
  tested:=tested+1;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  execute 'set local role authenticated';
  result:=public.admin_workshop_provisional_review_queue(st,offer);
  if jsonb_array_length(result)<>1 then raise exception 'review_queue_missing'; end if;
  purchase:=public.admin_confirm_workshop_provisional_hold(st,h,true);
  execute 'reset role'; tested:=tested+1;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  result:=public.service_demi_workshop_context(st,c);
  if result#>>'{current_purchase,status}'<>'confirmed' or result#>>'{current_purchase,paid_minor}'<>'30000' or result#>>'{current_purchase,balance_minor}'<>'30000' then raise exception 'context_confirmed_mismatch'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  tested:=tested+1;
  if not exists(select 1 from public.workshop_purchases p join public.class_sessions s on s.id=sessions[1] where p.id=(purchase->>'purchase_id')::uuid and p.balance_due_at=s.starts_at and p.paid_minor=30000) then raise exception 'first_date_or_deposit_mismatch'; end if;
  select reservation_id into reservation from public.workshop_purchase_sessions where purchase_id=(purchase->>'purchase_id')::uuid and session_id=sessions[1];
  tested:=tested+1;
  execute 'set local role authenticated';
  result:=public.admin_register_workshop_payment(st,(purchase->>'purchase_id')::uuid,10000,'efectivo','synthetic-abono',null);
  if result->>'balance_minor'<>'20000' then raise exception 'installment_balance_mismatch'; end if;
  if public.admin_register_workshop_payment(st,(purchase->>'purchase_id')::uuid,10000,'efectivo','synthetic-abono',null)->>'replayed'<>'true' then raise exception 'installment_replay_failed'; end if;
  execute 'reset role'; tested:=tested+1;
  if (select count(*) from public.payments where studio_id=st)<>2 then raise exception 'duplicate_payment'; end if;
  tested:=tested+1;
  execute 'set local role authenticated';
  result:=public.admin_student_workshops(st,student);
  if result->0->>'balanceMinor'<>'20000' then raise exception 'history_balance_mismatch'; end if;
  result:=public.admin_record_workshop_continuation(st,(purchase->>'purchase_id')::uuid,gen_random_uuid(),'withdraw','Synthetic explicit withdrawal');
  if result->>'released_count'<>'2' then raise exception 'withdrawal_mismatch'; end if;
  execute 'reset role'; tested:=tested+1;
  if (select paid_minor from public.workshop_purchases where id=(purchase->>'purchase_id')::uuid)<>40000 then raise exception 'withdrawal_erased_money'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('service_prepare_demi_workshop_purchase','service_record_demi_workshop_receipt','admin_register_workshop_installment','admin_record_workshop_continuation','service_demi_workshop_context') and has_function_privilege('anon',p.oid,'execute')) then raise exception 'anonymous_rpc_access'; end if;
  tested:=tested+1;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  result:=public.service_demi_workshop_context(st,c);
  if result#>>'{current_purchase,status}'<>'cancelled' or result#>>'{current_purchase,paid_minor}'<>'40000' or result#>>'{current_purchase,balance_minor}'<>'20000' or result#>>'{current_purchase,reservation_confirmed}'<>'false' then raise exception 'context_withdrawal_mismatch'; end if;
  execute 'reset role';
  tested:=tested+1;
  -- New guest profile: owned synthetic WhatsApp/CRM identity; no Auth or transport.
  insert into public.persons(id,studio_id,first_name,last_name) values(guest_person,st,'UAT','Contacto nuevo');
  insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(st,guest_person,'phone','+529999999991',true);
  insert into public.crm_contacts(id,studio_id,person_id,lifecycle_status,source) values(guest_contact,st,guest_person,'prospect','synthetic_workshop_rollback');
  insert into public.crm_conversations(id,studio_id,crm_contact_id,provider,channel,started_at,last_activity_at,contact_phone)
    values(guest_crm,st,guest_contact,'meta_whatsapp','whatsapp',now(),now(),'+529999999991');
  insert into public.assistant_conversations(id,studio_id,channel,external_thread_ref,crm_conversation_id,context)
    values(guest_c,st,'whatsapp','529999999991',guest_crm,jsonb_build_object('crm_contact_id',guest_contact,'contact_phone','+529999999991','provider','meta_whatsapp'));
  insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content)
    values(guest_request,st,guest_c,'inbound','user','Quiero inscribirme en el taller'),
      (guest_name_turn,st,guest_c,'inbound','user','Me llamo UAT Nueva Participante');
  execute 'set local role service_role';
  result:=public.service_register_demi_workshop_participant(st,guest_c,offer,guest_name_turn,'UAT Nueva Participante');
  guest_student:=(result->>'student_id')::uuid;
  if guest_student is null or result->>'reservation_confirmed'<>'false' or result->>'payment_verified'<>'false' then raise exception 'guest_registration_mismatch'; end if;
  tested:=tested+1;
  if public.service_register_demi_workshop_participant(st,guest_c,offer,guest_name_turn,'UAT Nueva Participante')->>'student_id' is distinct from guest_student::text then raise exception 'guest_replay_mismatch'; end if;
  execute 'reset role';
  if (select count(*) from public.students where studio_id=st and person_id=guest_person)<>1
    or not exists(select 1 from public.students where id=guest_student and user_id is null and student_type='trial' and trial_status is null and acquisition_source='demi_workshop_guest')
    or exists(select 1 from public.student_enrollments where studio_id=st and student_id=guest_student)
    or exists(select 1 from public.product_acquisitions where studio_id=st and student_id=guest_student)
    or exists(select 1 from public.sales where studio_id=st and student_id=guest_student)
    or exists(select 1 from public.reservations where studio_id=st and student_id=guest_student)
  then raise exception 'guest_unintended_rights_or_duplicates'; end if;
  tested:=tested+1;
  execute 'set local role service_role';
  intent:=public.service_prepare_demi_workshop_purchase(st,guest_c,offer,sessions,'full',guest_name_turn);
  execute 'reset role';
  insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content) values(guest_accept,st,guest_c,'inbound','user','Sí acepto');
  insert into public.assistant_whatsapp_events(id,studio_id,assistant_conversation_id,provider_event_id,phone_number_id,message_type,payload_fingerprint)
    values(guest_event,st,guest_c,'synthetic:'||guest_event,'synthetic-no-provider','image','synthetic-no-transport');
  execute 'set local role service_role';
  result:=public.service_accept_demi_workshop_purchase(st,guest_c,guest_accept);
  if result->>'reservation_confirmed'<>'false' or result->>'payment_verified'<>'false' then raise exception 'guest_acceptance_mismatch'; end if;
  tested:=tested+1;
  held:=public.service_record_demi_workshop_receipt(st,guest_c,(intent->>'intent_id')::uuid,guest_event,'synthetic:'||guest_event,st||'/workshop/'||(intent->>'intent_id')||'/'||repeat('b',64),repeat('b',64),30000,'MXN',0.99);
  execute 'reset role';
  if held->>'payment_verified'<>'false' or exists(select 1 from public.sales where studio_id=st and student_id=guest_student) then raise exception 'guest_premature_income'; end if;
  tested:=tested+1;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  execute 'set local role authenticated';
  purchase:=public.admin_confirm_workshop_provisional_hold(st,(held->>'hold_id')::uuid,true);
  execute 'reset role';
  if not exists(select 1 from public.workshop_purchases where id=(purchase->>'purchase_id')::uuid and student_id=guest_student and paid_minor=30000)
    or (select count(*) from public.payments where sale_id=(purchase->>'sale_id')::uuid)<>1
    or not exists(select 1 from public.students where id=guest_student and student_type='trial' and acquisition_source='demi_workshop_guest')
  then raise exception 'guest_checkout_mismatch'; end if;
  tested:=tested+1;
  raise exception using errcode='P0002',message='synthetic_fixture_rollback';
 exception when no_data_found then
  if sqlerrm<>'synthetic_fixture_rollback' then raise; end if;
 end;
 if exists(select 1 from public.studios where id=st) or exists(select 1 from public.workshop_offers where id=offer) then raise exception 'fixture_leaked'; end if;
 perform set_config('uat.demi_workshop_context_20261023',jsonb_build_object('checks',tested,'result','PASS','fixture_rolled_back',true,'real_db_roles',true,'browser_authenticated',false,'model_ocr_transport_invoked',false,'real_money',false,'guest_profile_and_checkout',true)::text,false);
end $test$;
select current_setting('uat.demi_workshop_context_20261023')::jsonb as evidence;
