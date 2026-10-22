-- Acceptance probe, not a migration. Sandbox synthetic tenants; always rollback.
-- A deliberately reports BLOCKED when existing RPC falls short of the agreed rule.
begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare
 source uuid := '9fe23cfa-fb47-4670-afeb-ed4a56433772'; actor uuid;
 run jsonb; s uuid; st uuid; c uuid; ev uuid; session uuid; pack uuid; enroll uuid;
 intent uuid; payment uuid; first_sale uuid; target_sale uuid; acquisition uuid;
 r jsonb; today date; mode text; amount integer; original_payment jsonb;
 balance integer; starts date; expiry date; first_acquisition uuid; linked boolean;
 outcomes jsonb := '[]'; original_reservation uuid; boundary text; class_time timestamptz;
 expected_options integer; actual_options integer; zone text;
begin
 select user_id into strict actor from public.studio_memberships
 where studio_id=source and active and role='owner' limit 1;
 foreach mode in array array['only_class','A_integrated','B_separate'] loop
  execute 'set local role service_role';
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  run:=public.service_create_demi_uat_run(source,actor,'A07-engine-probe-'||mode);
  s:=(run->>'studio_id')::uuid;
  st:=(run#>>'{fixtures,people,trial_payment_rejected,student_id}')::uuid;
  session:=(run#>>'{fixtures,sessions,available}')::uuid;
  pack:=(run#>>'{fixtures,products,package}')::uuid;
  enroll:=(run#>>'{fixtures,products,enrollment}')::uuid;
  select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=s;
  update public.class_sessions set starts_at=clock_timestamp()+interval '20 minutes',
   ends_at=clock_timestamp()+interval '80 minutes' where id=session;
  c:=gen_random_uuid(); ev:=gen_random_uuid();
  insert into public.assistant_conversations(id,studio_id,student_id,channel)
  values(c,s,st,'internal_demo');
  r:=public.service_prepare_trial_transfer(s,c,st,session,null);
  intent:=(r->>'intent_id')::uuid;
  if intent is null then raise exception 'trial_prepare:%',r; end if;
  insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,
   phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint)
  values(ev,s,'meta_whatsapp','A07-SYNTHETIC-'||ev,'UAT-SYNTHETIC','99900000007',
   'image','SYNTHETIC-NO-OCR','A07-SYNTHETIC');
  update public.assistant_transfer_purchase_intents set receipt_amount_matches=true,
   receipt_storage_path='UAT/synthetic-a07-no-money.png' where id=intent;
  r:=public.service_activate_trial_transfer_receipt(s,c,st,intent,ev,'A07-SYNTHETIC-'||ev,'SYNTHETIC-NO-OCR');
  if r->>'ok'<>'true' then raise exception 'trial_activate:%',r; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  r:=public.admin_review_transfer_purchase(intent,'approved','Synthetic A07 acceptance probe, rolled back');
  if r->>'ok'<>'true' then raise exception 'trial_review:%',r; end if;
  select p.id,p.sale_id,to_jsonb(p) into strict payment,first_sale,original_payment
  from public.payments p join public.assistant_transfer_purchase_intents i on i.sale_id=p.sale_id
  where i.id=intent and p.kind='payment';
  select acquisition_id,reservation_id into first_acquisition,original_reservation
  from public.assistant_transfer_purchase_intents where id=intent;
  if mode='only_class' then
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant',mode,
    'status',case when (select sum(amount_minor) from public.payments where studio_id=s)=15000
     and not exists(select 1 from public.student_enrollments where student_id=st)
     and not exists(select 1 from public.product_acquisitions where student_id=st and product_template_id=pack)
     then 'PASSED_ENGINE' else 'FAILED' end,
    'paid_minor',(select sum(amount_minor) from public.payments where studio_id=s),
    'enrollment_count',(select count(*) from public.student_enrollments where student_id=st),
    'package_count',(select count(*) from public.product_acquisitions where student_id=st and product_template_id=pack)));
   select timezone into zone from public.studios where id=s;
   foreach boundary in array array['same_utc_day_previous_local_day','next_utc_day_same_local_day',
    'local_previous_235959','local_today_midnight'] loop
    class_time:=case boundary
     when 'same_utc_day_previous_local_day' then (today+time '00:30') at time zone 'UTC'
     when 'next_utc_day_same_local_day' then (today+1+time '02:30') at time zone 'UTC'
     when 'local_previous_235959' then (today-1+time '23:59:59') at time zone zone
     else today::timestamp at time zone zone end;
    expected_options:=case when boundary in ('same_utc_day_previous_local_day','local_previous_235959') then 0 else 1 end;
    update public.class_sessions set starts_at=class_time,ends_at=class_time+interval '1 hour' where id=session;
    actual_options:=jsonb_array_length(public.get_trial_enrollment_credit_options(st));
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant',boundary,
     'status',case when actual_options=expected_options then 'PASSED_ENGINE' else 'FAILED' end,
     'timezone',zone,'class_utc',class_time,'class_local_date',(class_time at time zone zone)::date,
     'expected_options',expected_options,'actual_options',actual_options));
   end loop;
  else
   if mode='A_integrated' then
    select price_minor+5000 into amount from public.product_templates where id=pack;
    r:=public.create_package_with_trial_enrollment_credit(st,pack,enroll,payment,gen_random_uuid(),
     'first_usage',null,amount,'cash',today,'SYNTHETIC','Acceptance probe; no real money');
   else
    select p.price_minor+e.price_minor into amount from public.product_templates p
     cross join public.product_templates e where p.id=pack and e.id=enroll;
    r:=public.create_student_onboarding_sale_v2(st,pack,enroll,gen_random_uuid(),'first_usage',null,
     0,null,null,null,'paid',today,null,amount,'cash',today,'SYNTHETIC',
     'Acceptance probe; no real money',null,null,false,null,0,null);
   end if;
   target_sale:=(r->>'sale_id')::uuid;
   if target_sale is null then raise exception 'purchase:%',r; end if;
   select a.id,a.starts_on,a.expires_on into strict acquisition,starts,expiry
   from public.product_acquisitions a join public.sale_lines sl on sl.id=a.sale_line_id
   where sl.sale_id=target_sale and a.product_template_id=pack;
   select coalesce(sum(quantity),0) into balance from public.credit_ledger where acquisition_id=acquisition;
   select acquisition_id=acquisition into linked from public.reservations where id=original_reservation;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant',mode,
    'status',case when mode='A_integrated' and (balance<>7 or starts is distinct from today or not linked)
      then 'BLOCKED_ENGINE_DEPENDENCY' when mode='B_separate' and balance=8 and starts is null
      and not linked then 'PASSED_ENGINE' else 'FAILED' end,
    'additional_paid_minor',amount,'total_paid_minor',(select sum(amount_minor) from public.payments where studio_id=s),
    'package_balance',balance,'expected_balance',case when mode='A_integrated' then 7 else 8 end,
    'starts_on',starts,'expires_on',expiry,'expected_A_start',today,
    'first_class_linked_to_package',linked,'original_payment_unchanged',
    (select to_jsonb(p)=original_payment from public.payments p where id=payment),
    'commercial_credit_rows',(select count(*) from public.trial_enrollment_credits where studio_id=s),
    'reservation_count',(select count(*) from public.reservations where student_id=st),
    'dependency',case when mode='A_integrated' then 'DEMI-PROS-02' else null end));
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 end loop;
 perform set_config('uat.a07_probe',outcomes::text,true);
end;
$uat$;
select current_setting('uat.a07_probe')::jsonb as results;
rollback;
