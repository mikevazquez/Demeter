begin;
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare owner uuid; run jsonb; s uuid; st uuid; product uuid; ev uuid:=gen_random_uuid(); ev2 uuid:=gen_random_uuid(); mid text:='uat-facebook-'||gen_random_uuid(); mid2 text:='uat-facebook-'||gen_random_uuid(); r jsonb; first_result jsonb; outcomes jsonb:='[]'; attempt uuid:=gen_random_uuid(); amount integer; currency text; pt public.product_templates%rowtype; before_sales integer; before_payments integer; code text; field text; order_id text:='uat-order-'||gen_random_uuid(); payment_id text:='uat-payment-'||gen_random_uuid();
begin
 select user_id into owner from public.studio_memberships where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' and active and role='owner' limit 1;
 run:=public.service_create_demi_uat_run('9fe23cfa-fb47-4670-afeb-ed4a56433772',owner,'connected-channels-uat');s:=(run->>'studio_id')::uuid;
 st:=(run#>>'{fixtures,people,student_active,student_id}')::uuid;product:=(run#>>'{fixtures,products,package}')::uuid;
 insert into public.assistant_meta_inbox_events(id,studio_id,provider,provider_event_id,provider_account_id,provider_contact_id,message_type,payload_fingerprint) values(ev,s,'facebook_messenger',mid,'uat-page','uat-contact','text','uat-fb');
 r:=public.service_prepare_meta_inbox_message(s,ev,'facebook_messenger','uat-page',mid,'uat-contact','UAT Facebook','text','Hola, quiero conocer las clases',clock_timestamp());first_result:=r;
 if not coalesce((r->>'ok')::boolean,false) or r->>'student_id' is not null or not exists(select 1 from public.assistant_conversations where id=(r->>'assistant_conversation_id')::uuid and channel='facebook_messenger' and student_id is null) then raise exception 'fb_new_identity:%',r; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M01','variant','facebook_creates_prospect_identity_without_enrolling','passed',true));
 r:=public.service_prepare_meta_inbox_message(s,ev,'facebook_messenger','uat-page',mid,'uat-contact','UAT Facebook','text','Hola',clock_timestamp());
 if r->>'identity_id'<>first_result->>'identity_id' or r->>'inbound_turn_id'<>first_result->>'inbound_turn_id' or (select count(*) from public.assistant_turns where studio_id=s and channel_message_ref=mid)<>1 then raise exception 'fb_duplicate_inbound:%',r; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M01','variant','facebook_duplicate_event_keeps_identity_and_one_turn','passed',true));
 insert into public.assistant_meta_inbox_events(id,studio_id,provider,provider_event_id,provider_account_id,provider_contact_id,message_type,payload_fingerprint) values(ev2,s,'facebook_messenger',mid2,'uat-page','uat-contact','text','uat-fb-2');
 r:=public.service_prepare_meta_inbox_message(s,ev2,'facebook_messenger','uat-page',mid2,'uat-contact','UAT Facebook','text','Mi celular es 9990000003',clock_timestamp());
 if r->>'assistant_conversation_id'<>first_result->>'assistant_conversation_id' or r->>'student_id' is not null then raise exception 'fb_typed_phone_authenticates:%',r; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M01','variant','facebook_continuity_does_not_authenticate_typed_phone','passed',true));
 r:=public.service_prepare_meta_inbox_message(s,ev2,'facebook_messenger','different-page',mid2,'uat-contact','UAT Facebook','text','Hola',clock_timestamp());
 if r->>'reason_code'<>'source_event_invalid' then raise exception 'fb_account_scope:%',r; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M01','variant','facebook_wrong_page_source_event_blocked','passed',true));
 perform public.assistant_create_handoff(s,(first_result->>'assistant_conversation_id')::uuid,null,'human_requested','UAT solicitud humana');
 r:=public.service_prepare_meta_inbox_message(s,ev2,'facebook_messenger','uat-page',mid2,'uat-contact','UAT Facebook','text','Necesito ayuda',clock_timestamp());
 if not (r->>'handoff_open')::boolean then raise exception 'fb_handoff_not_returned'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M17','variant','facebook_pending_human_attention_preserved','passed',true));
 select * into pt from public.product_templates where id=product and studio_id=s;amount:=pt.price_minor;currency:=upper(pt.currency);
 insert into public.online_checkout_attempts(id,studio_id,student_id,product_template_id,provider,client_request_key,external_reference,amount_minor,currency,status,provider_order_id,product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,unlimited_snapshot,package_term_snapshot,regular_amount_minor,reward_discount_minor,reward_discount_pct)
 values(attempt,s,st,product,'mercado_pago',gen_random_uuid(),'STFLOW-MP-'||attempt,amount,currency,'order_created',order_id,pt.name,pt.validity_days,pt.credit_limit,pt.unlimited,pt.package_term,amount,0,0);
 select count(*) into before_sales from public.sales where studio_id=s;select count(*) into before_payments from public.payments where studio_id=s;
 if exists(select 1 from public.online_checkout_attempts where id=attempt and sale_id is not null) then raise exception 'mp_unpaid_fulfilled'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M08','variant','mercado_pago_order_created_has_no_sale_or_payment','passed',true));
 foreach field in array array['order','reference','status','amount','currency'] loop
  code:=null;
  begin
   perform public.service_confirm_online_checkout_approved(attempt,case when field='order' then 'wrong-order' else order_id end,payment_id,case when field='reference' then 'wrong-reference' else 'STFLOW-MP-'||attempt end,case when field='status' then 'pending' else 'processed' end,'accredited',case when field='amount' then amount-1 else amount end,case when field='currency' then 'USD' else currency end);
  exception when others then code:=sqlerrm; end;
  if code is distinct from (case field when 'order' then 'provider_order_mismatch' when 'reference' then 'external_reference_mismatch' when 'status' then 'provider_not_approved' when 'amount' then 'paid_amount_mismatch' when 'currency' then 'currency_mismatch' end) then raise exception 'mp_validation_%:%',field,code; end if;
  if (select count(*) from public.sales where studio_id=s)<>before_sales or (select count(*) from public.payments where studio_id=s)<>before_payments then raise exception 'mp_rejected_wrote_money'; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M08','variant','mercado_pago_'||field||'_mismatch_rejected_without_fulfillment','passed',true));
 end loop;
 r:=public.service_confirm_online_checkout_approved(attempt,order_id,payment_id,'STFLOW-MP-'||attempt,'processed','accredited',amount,currency);
 if not (r->>'ok')::boolean or (r->>'reused')::boolean or (select count(*) from public.sales where studio_id=s)<>before_sales+1 or (select count(*) from public.payments where studio_id=s)<>before_payments+1 or not exists(select 1 from public.product_acquisitions where id=(r->>'acquisition_id')::uuid and student_id=st) then raise exception 'mp_approved_fulfillment:%',r; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M08','variant','mercado_pago_approved_creates_one_sale_payment_and_package','passed',true));
 r:=public.service_confirm_online_checkout_approved(attempt,order_id,payment_id,'STFLOW-MP-'||attempt,'processed','accredited',amount,currency);
 if not (r->>'reused')::boolean or (select count(*) from public.sales where studio_id=s)<>before_sales+1 or (select count(*) from public.payments where studio_id=s)<>before_payments+1 then raise exception 'mp_approval_replay_duplicates'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M09','variant','mercado_pago_approval_replay_does_not_duplicate_money','passed',true));
 code:=null;
 begin
  perform public.service_confirm_online_checkout_approved(attempt,order_id,'wrong-payment','STFLOW-MP-'||attempt,'processed','accredited',amount,currency);
 exception when others then code:=sqlerrm; end;
 if code is distinct from 'provider_payment_mismatch' or (select count(*) from public.payments where studio_id=s)<>before_payments+1 then raise exception 'mp_paid_identity_changed:%',code; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('case','M09','variant','mercado_pago_paid_order_cannot_change_payment_identity','passed',true));
 perform set_config('uat.connected_results',outcomes::text,true);
end $uat$;
select current_setting('uat.connected_results')::jsonb as results;
rollback;
