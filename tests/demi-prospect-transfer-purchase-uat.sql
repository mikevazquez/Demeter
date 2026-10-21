-- DEMI-PROS-03A · UAT for 20261021210000_demi_prospect_transfer_purchase (Sandbox only, rollback).
-- C1 prepare records only the pending purchase (no person/student/contact change)
-- C2 enrollment + package total for a package that requires enrollment
-- C3 receipt -> awaiting_profile, idempotent
-- C4 invalid profile data rejected without changes
-- C5 profile completes: student created, enrollment + package active, contact converted
-- C6 replay returns the same result; C7 grants
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  owner uuid; run jsonb; s uuid; c uuid := gen_random_uuid(); person uuid; contact uuid;
  pack uuid; enr uuid; pack_price integer; enr_price integer; r jsonb; intent uuid; ev uuid;
  students_before integer; student uuid;
begin
  select user_id into owner from public.studio_memberships
  where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' and role='owner' and active limit 1;
  run := public.service_create_demi_uat_run('9fe23cfa-fb47-4670-afeb-ed4a56433772',owner,'demi-pros-03a-prospect-transfer');
  s := (run->>'studio_id')::uuid;
  select id,price_minor into pack,pack_price from public.product_templates where studio_id=s and name='Paquete UAT 8 clases';
  select id,price_minor into enr,enr_price from public.product_templates where studio_id=s and product_type='enrollment';
  update public.enrollment_policies set enabled=true,required_for_package_purchase=true,enrollment_product_template_id=enr where studio_id=s;
  update public.product_templates set enrollment_included=false where id=pack;

  insert into public.persons(studio_id,first_name) values(s,'Prospecto UAT') returning id into person;
  insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(s,person,'phone','+529990001234',true);
  insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source) values(s,person,'prospect','uat') returning id into contact;
  insert into public.assistant_conversations(id,studio_id,channel,external_thread_ref,context)
  values(c,s,'whatsapp','pros03a-'||c,jsonb_build_object('crm_contact_id',contact::text));
  select count(*) into students_before from public.students where studio_id=s;

  r := public.service_preview_prospect_transfer_purchase(s,c,contact,pack);
  if r->>'enrollment_required'<>'true' or (r->>'total_amount_minor')::int<>pack_price+enr_price then raise exception 'C2_preview:%',r; end if;
  r := public.service_prepare_prospect_transfer_purchase(s,c,contact,null,pack);
  if r->>'ok'<>'true' or (r->>'total_amount_minor')::int<>pack_price+enr_price then raise exception 'C1_prepare:%',r; end if;
  intent := (r->>'intent_id')::uuid;
  if (select count(*) from public.students where studio_id=s)<>students_before then raise exception 'C1_student_created_before_payment'; end if;
  if (select first_name from public.persons where id=person)<>'Prospecto UAT' then raise exception 'C1_person_changed'; end if;
  if (select lifecycle_status from public.crm_contacts where id=contact)<>'prospect' then raise exception 'C1_contact_changed'; end if;

  insert into public.assistant_whatsapp_events(studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,processing_status)
  values(s,'meta_whatsapp','uat-receipt-'||intent,'uat','529990001234','image','processed') returning id into ev;
  r := public.service_record_prospect_transfer_receipt(s,c,contact,intent,ev,'uat-receipt-'||intent,'uat-media');
  if r->>'status'<>'awaiting_profile' then raise exception 'C3_receipt:%',r; end if;
  r := public.service_record_prospect_transfer_receipt(s,c,contact,intent,ev,'uat-receipt-'||intent,'uat-media');
  if r->>'idempotent'<>'true' then raise exception 'C3_replay:%',r; end if;
  if (select count(*) from public.students where studio_id=s)<>students_before then raise exception 'C3_student_created_before_profile'; end if;

  r := public.service_complete_prospect_transfer_purchase(s,c,contact,'Solo',date '1995-05-10','uat@example.test');
  if r->>'reason_code'<>'full_name_required' then raise exception 'C4_name:%',r; end if;
  r := public.service_complete_prospect_transfer_purchase(s,c,contact,'Ana Prueba',date '1995-05-10','no-es-correo');
  if r->>'reason_code'<>'email_invalid' then raise exception 'C4_email:%',r; end if;

  r := public.service_complete_prospect_transfer_purchase(s,c,contact,'Ana Prueba Sintética',date '1995-05-10','ana.uat.'||left(contact::text,8)||'@example.test');
  if r->>'ok'<>'true' then raise exception 'C5_complete:%',r; end if;
  student := (r->>'student_id')::uuid;
  if (select status from public.assistant_transfer_purchase_intents where id=intent)<>'provisional_active' then raise exception 'C5_intent'; end if;
  if not exists(select 1 from public.product_acquisitions where studio_id=s and student_id=student and product_template_id=pack and status='active') then raise exception 'C5_package'; end if;
  if not exists(select 1 from public.student_enrollments where studio_id=s and student_id=student and status='active' and resolution_type='paid') then raise exception 'C5_enrollment'; end if;
  if (select student_type::text from public.students where id=student)<>'regular' then raise exception 'C5_not_regular'; end if;
  if (select lifecycle_status from public.crm_contacts where id=contact)<>'student' then raise exception 'C5_contact'; end if;
  if (select total_minor from public.sales where idempotency_key=intent)<>pack_price+enr_price then raise exception 'C5_sale_total'; end if;

  r := public.service_complete_prospect_transfer_purchase(s,c,contact,'Ana Prueba Sintética',date '1995-05-10','otro@example.test');
  if r->>'idempotent'<>'true' then raise exception 'C6_replay:%',r; end if;

  if has_function_privilege('authenticated','public.service_complete_prospect_transfer_purchase(uuid,uuid,uuid,text,date,text)','EXECUTE') then raise exception 'C7_permissions'; end if;
end $$;
select 'passed' result, 7 controls, 'synthetic prospect; rollback; no real payment or message' scope;
rollback;
