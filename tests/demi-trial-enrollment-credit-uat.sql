begin;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; actor uuid; run jsonb; s uuid; st uuid; c uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); session uuid;
 intent uuid; payment uuid; source_sale uuid; pack uuid; enroll uuid; key uuid:=gen_random_uuid(); sale uuid; r jsonb; today date; amount integer; outcomes jsonb:='[]'; rejected boolean;
begin
 select user_id into actor from public.studio_memberships where studio_id=source and active and role='owner' limit 1;
 run:=public.service_create_demi_uat_run(source,actor,'trial-enrollment-credit-uat'); s:=(run->>'studio_id')::uuid;
 st:=(run#>>'{fixtures,people,trial_payment_rejected,student_id}')::uuid;
 session:=(run#>>'{fixtures,sessions,available}')::uuid; pack:=(run#>>'{fixtures,products,package}')::uuid; enroll:=(run#>>'{fixtures,products,enrollment}')::uuid;
 select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=s;
 update public.class_sessions set starts_at=now()+interval '20 minutes',ends_at=now()+interval '80 minutes' where id=session;
 insert into public.assistant_conversations(id,studio_id,student_id,channel) values(c,s,st,'internal_demo');
 r:=public.service_prepare_trial_transfer(s,c,st,session,null); intent:=(r->>'intent_id')::uuid;
 if intent is null then raise exception 'credit_prepare:%',r; end if;
 insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint)
 values(event,s,'meta_whatsapp','credit-'||event,'uat','99900000007','image','credit-media','credit-uat');
 update public.assistant_transfer_purchase_intents set receipt_amount_matches=true,receipt_storage_path='UAT/fictional-credit.png' where id=intent;
 r:=public.service_activate_trial_transfer_receipt(s,c,st,intent,event,'credit-'||event,'credit-media');
 if r->>'ok'<>'true' then raise exception 'credit_activate:%',r; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 if public.get_trial_enrollment_credit_options(st)<>'[]' then raise exception 'unvalidated_credit_offered'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','unvalidated_blocked','passed',true));
 r:=public.admin_review_transfer_purchase(intent,'approved','Fictitious UAT receipt');
 select p.id,p.sale_id into payment,source_sale from public.payments p join public.assistant_transfer_purchase_intents i on i.sale_id=p.sale_id where i.id=intent and p.kind='payment';
 if jsonb_array_length(public.get_trial_enrollment_credit_options(st))<>1 then raise exception 'valid_credit_not_offered'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','paid_same_day_eligible','passed',true));
 update public.class_sessions set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=session;
 if public.get_trial_enrollment_credit_options(st)<>'[]' then raise exception 'other_day_eligible'; end if;
 update public.class_sessions set starts_at=starts_at-interval '1 day',ends_at=ends_at-interval '1 day' where id=session;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','other_day_blocked','passed',true));
 update public.assistant_admin_rules set enabled=false where studio_id=s and rule_key='trial_payment_towards_enrollment';
 if public.get_trial_enrollment_credit_options(st)<>'[]' then raise exception 'disabled_rule_eligible'; end if;
 update public.assistant_admin_rules set enabled=true where studio_id=s and rule_key='trial_payment_towards_enrollment';
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','tenant_rule_gate','passed',true));
 select price_minor+5000 into amount from public.product_templates where id=pack;
 rejected:=false;
 begin
  perform public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,key,'first_usage',null,amount-1,'cash',today,null,null);
 exception when others then if SQLERRM='trial_credit_full_payment_required' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'partial_purchase_allowed'; end if;
 if exists(select 1 from public.sales where studio_id=s and idempotency_key=key) then raise exception 'failed_purchase_left_sale'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','incomplete_payment_atomic_rejection','passed',true));
 rejected:=false;
 begin
  perform public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,key,'first_usage',null,amount,'cash',today-1,null,null);
 exception when others then if SQLERRM='trial_credit_same_day_required' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'backdated_credit_allowed'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','backdated_purchase_blocked','passed',true));
 r:=public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,key,'first_usage',null,amount,'cash',today,'UAT','Fictitious purchase');
 sale:=(r->>'sale_id')::uuid;
 if sale is null or (r->>'total_minor')::integer<>amount then raise exception 'credit_purchase:%',r; end if;
 if (select line_total_minor from public.sale_lines where sale_id=sale and product_template_id=pack)<>(select price_minor from public.product_templates where id=pack)
 or (select line_total_minor from public.sale_lines where sale_id=sale and product_template_id=enroll)<>5000 then raise exception 'credit_wrong_line'; end if;
 if not exists(select 1 from public.student_enrollments se join public.sale_lines sl on sl.id=se.source_sale_line_id where sl.sale_id=sale and se.status='active' and se.resolution_type='paid') then raise exception 'credit_enrollment_missing'; end if;
 if (select count(*) from public.payments where sale_id=source_sale)<>1 or (select amount_minor from public.payments where id=payment)<>15000
 or (select count(*) from public.payments where sale_id=sale)<>1 or (select amount_minor from public.payments where sale_id=sale)<>amount then raise exception 'original_payment_rewritten_or_counted_twice'; end if;
 if (select sum(amount_minor) from public.payments where sale_id in (source_sale,sale))<>amount+15000 then raise exception 'credit_money_invented'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','enrollment_50_full_package_original_receipt_preserved','passed',true));
 r:=public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,key,'first_usage',null,amount,'cash',today,null,null);
 if r->>'replayed'<>'true' or (r->>'sale_id')::uuid<>sale or (select count(*) from public.trial_enrollment_credits where studio_id=s)<>1 or (select count(*) from public.payments where sale_id=sale)<>1 then raise exception 'credit_replay_duplicated'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','replay_once','passed',true));
 rejected:=false;
 begin
  perform public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,gen_random_uuid(),'today',null,amount,'cash',today,null,null);
 exception when others then if SQLERRM='trial_credit_unavailable' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'credit_reused'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','second_application_blocked','passed',true));
 rejected:=false;
 begin
  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,effective_on) values(s,source_sale,'refund',15000,'cash',today);
 exception when others then if SQLERRM='trial_credit_source_already_applied' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'applied_receipt_refunded_independently'; end if;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','source_refund_requires_linked_resolution','passed',true));
 perform set_config('uat.trial_enrollment_credit',outcomes::text,true);
end; $uat$;
select current_setting('uat.trial_enrollment_credit')::jsonb as results;
rollback;
