begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; run jsonb; s uuid; st uuid; c uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r jsonb; intent uuid; receipt uuid; today date;
begin
 select user_id into owner from public.studio_memberships where studio_id=source and role='owner' and active limit 1;
 run:=public.service_create_demi_uat_run(source,owner,'enrollment-review-uat'); s:=(run->>'studio_id')::uuid; st:=(run#>>'{fixtures,people,former_active_package,student_id}')::uuid;
 select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=s;
 if not exists(select 1 from public.student_enrollments where student_id=st and expires_on=today-1) then raise exception 'fixture_not_local_expired'; end if;
 insert into public.assistant_conversations(id,studio_id,channel,student_id) values(c,s,'internal_demo',st);
 r:=public.service_prepare_demi_enrollment_payment(s,c,st,'bank_transfer');
 if r->>'ok'<>'true' or r->>'enrollment_activated'<>'false' then raise exception 'prepare:%',r; end if;
 intent:=(r->>'intent_id')::uuid;
 r:=public.service_prepare_demi_enrollment_payment(s,c,st,'bank_transfer');
 if (r->>'intent_id')::uuid<>intent then raise exception 'duplicate_intent'; end if;
 insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint,assistant_conversation_id)
 values(e,s,'meta_whatsapp','enrollment-'||e,'uat','529990000004','image','uat-media','enrollment-uat',c);
 r:=public.service_record_demi_enrollment_receipt(s,gen_random_uuid(),intent,e,'enrollment-'||e,s||'/enrollment/'||intent||'/a',repeat('a',64),20000,'MXN',0.99);
 if r->>'ok'<>'false' then raise exception 'foreign_conversation'; end if;
 r:=public.service_record_demi_enrollment_receipt(s,c,intent,e,'enrollment-'||e,s||'/enrollment/'||intent||'/a',repeat('a',64),20000,'MXN',0.99);
 if r->>'ok'<>'true' or r->>'human_review_created'<>'true' or r->>'enrollment_activated'<>'false' then raise exception 'record:%',r; end if;
 receipt:=(r->>'receipt_id')::uuid;
 if not exists(select 1 from public.assistant_handoffs where id::text=r->>'handoff_id' and status='open' and context->>'enrollment_receipt_id'=receipt::text) then raise exception 'missing_human_refs'; end if;
 r:=public.service_record_demi_enrollment_receipt(s,c,intent,e,'enrollment-'||e,s||'/enrollment/'||intent||'/a',repeat('a',64),20000,'MXN',0.99);
 if r->>'idempotent'<>'true' then raise exception 'receipt_replay'; end if;
 perform set_config('uat.enro_studio',s::text,true); perform set_config('uat.enro_owner',owner::text,true); perform set_config('uat.enro_student',st::text,true); perform set_config('uat.enro_conversation',c::text,true); perform set_config('uat.enro_intent',intent::text,true); perform set_config('uat.enro_receipt',receipt::text,true);
 perform set_config('uat.enro_credits',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]')::text from public.credit_ledger l where acquisition_id in (select id from public.product_acquisitions where student_id=st and studio_id=s)),true);
 perform set_config('uat.enro_packages',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text from public.product_acquisitions a where student_id=st),true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('uat.enro_owner'))::text,true);
select set_config('request.jwt.claim.sub',current_setting('uat.enro_owner'),true);
set local request.jwt.claim.role='authenticated';
do $$
declare s uuid:=current_setting('uat.enro_studio')::uuid; receipt uuid:=current_setting('uat.enro_receipt')::uuid; r jsonb;
begin
 r:=public.admin_review_demi_enrollment_receipt(s,receipt,'rejected','Documento de prueba rechazado: ingreso no confirmado');
 if r->>'ok'<>'true' or r->>'enrollment_activated'<>'false' then raise exception 'reject:%',r; end if;
 if (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text from public.product_acquisitions a where student_id=current_setting('uat.enro_student')::uuid)<>current_setting('uat.enro_packages') then raise exception 'reject_changed_package'; end if;
 r:=public.admin_review_demi_enrollment_receipt(s,receipt,'approved','No debe aprobar documento rechazado');
 if r->>'reason_code'<>'receipt_not_reviewable' then raise exception 'approve_rejected:%',r; end if;
end $$;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare s uuid:=current_setting('uat.enro_studio')::uuid; c uuid:=current_setting('uat.enro_conversation')::uuid; intent uuid:=current_setting('uat.enro_intent')::uuid; e uuid:=gen_random_uuid(); r jsonb;
begin
 insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint,assistant_conversation_id) values(e,s,'meta_whatsapp','enrollment-'||e,'uat','529990000004','image','uat-media','corrected-enrollment',c);
 r:=public.service_record_demi_enrollment_receipt(s,c,intent,e,'enrollment-'||e,s||'/enrollment/'||intent||'/b',repeat('b',64),20000,'MXN',0.99);
 if r->>'ok'<>'true' or r->>'human_review_created'<>'true' then raise exception 'corrected:%',r; end if;
 perform set_config('uat.enro_receipt',r->>'receipt_id',true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('uat.enro_owner'))::text,true);
select set_config('request.jwt.claim.sub',current_setting('uat.enro_owner'),true);
set local request.jwt.claim.role='authenticated';
do $$
declare s uuid:=current_setting('uat.enro_studio')::uuid; st uuid:=current_setting('uat.enro_student')::uuid; receipt uuid:=current_setting('uat.enro_receipt')::uuid; r jsonb; sale uuid;
begin
 r:=public.admin_review_demi_enrollment_receipt(s,receipt,'approved','Ingreso ficticio confirmado únicamente en UAT');
 if r->>'ok'<>'true' or r->>'enrollment_activated'<>'true' then raise exception 'approve:%',r; end if;
 sale:=(r->>'sale_id')::uuid;
 if (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text from public.product_acquisitions a where student_id=st)<>current_setting('uat.enro_packages') then raise exception 'approval_changed_package'; end if;
 if (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]')::text from public.credit_ledger l where acquisition_id in (select id from public.product_acquisitions where student_id=st and studio_id=s))<>current_setting('uat.enro_credits') then raise exception 'approval_changed_credits'; end if;
 if not exists(select 1 from public.student_enrollments where student_id=st and status='active' and expires_on>(clock_timestamp() at time zone 'America/Mexico_City')::date) then raise exception 'enrollment_not_active'; end if;
 r:=public.admin_review_demi_enrollment_receipt(s,receipt,'approved','Reintento de revisión UAT');
 if r->>'idempotent'<>'true' or (r->>'sale_id')::uuid<>sale or (select count(*) from public.payments where sale_id=sale)<>1 then raise exception 'duplicate_payment:%',r; end if;
end $$;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare s uuid:=current_setting('uat.enro_studio')::uuid; n public.demi_receipt_review_notices%rowtype; r jsonb;
begin
 if (select count(*) from public.demi_receipt_review_notices where studio_id=s)<>2 then raise exception 'review_notice_dedup'; end if;
 if exists(select 1 from public.service_claim_demi_receipt_review_notices(s)) then raise exception 'notice_sent_while_human_open'; end if;
 update public.assistant_handoffs set status='resolved' where studio_id=s and status='open';
 for n in select * from public.service_claim_demi_receipt_review_notices(s) loop
  r:=public.service_revalidate_demi_receipt_review_notice(n.id,n.notification_lease);
  if n.decision='rejected' then if r->>'eligible'<>'false' then raise exception 'superseded_rejection_sent'; end if;
  else
   if r->>'eligible'<>'true' then raise exception 'approval_notice_not_eligible'; end if;
   r:=public.service_finish_demi_receipt_review_notice(n.id,gen_random_uuid(),true,'uat:wrong',null,n.notification_text);
   if r->>'reason_code'<>'notification_lease_lost' then raise exception 'foreign_notice_lease'; end if;
   r:=public.service_finish_demi_receipt_review_notice(n.id,n.notification_lease,true,'uat:approved',null,n.notification_text);
   if r->>'status'<>'sent' then raise exception 'notice_finish:%',r; end if;
   r:=public.service_finish_demi_receipt_review_notice(n.id,n.notification_lease,true,'uat:approved',null,n.notification_text);
   if r->>'reason_code'<>'notification_lease_lost' then raise exception 'notice_replay'; end if;
  end if;
 end loop;
end $$;
do $$
declare s uuid:=current_setting('uat.enro_studio')::uuid; st uuid:=current_setting('uat.enro_student')::uuid; session uuid; r jsonb; a uuid; expiry date; starts date; balance integer;
begin
 select id,starts_on,expires_on into a,starts,expiry from public.product_acquisitions where student_id=st and studio_id=s limit 1;
 select id into session from public.class_sessions where studio_id=s and notes='UAT available' limit 1;
 r:=public.service_book_student(s,session,st);
 if r->>'eligible'<>'true' then raise exception 'renewed_booking:%',r; end if;
 select sum(quantity) into balance from public.credit_ledger where acquisition_id=a;
 if balance<>7 then raise exception 'renewed_credit:%',balance; end if;
 r:=public.service_book_student(s,session,st);
 if (select sum(quantity) from public.credit_ledger where acquisition_id=a)<>7 or (select count(*) from public.reservations where student_id=st and session_id=session and status='reserved')<>1 then raise exception 'renewed_booking_replay'; end if;
 if not exists(select 1 from public.product_acquisitions where id=a and starts_on=starts and expires_on=expiry) then raise exception 'renewed_package_dates_changed'; end if;
end $$;
select jsonb_build_object('passed',true,'controls',array['local_expiry_fixture','intent_idempotency','owned_conversation','human_case_with_receipt','receipt_replay','reject_no_rights','rejected_cannot_approve','corrected_receipt','enrollment_only_sale','package_unchanged','approval_replay_single_payment','notice_dedup','human_pause','superseded_rejection_suppressed','owned_notice_lease','notice_finish_replay','credits_preserved_until_booking','renewed_booking_single_credit','renewed_booking_replay','original_package_dates_preserved']) as result;
rollback;
