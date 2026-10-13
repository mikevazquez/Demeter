begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare
 s uuid := '29af8ae6-1c55-497d-b53c-d6d7b6fc828d';
 c uuid := gen_random_uuid(); sess uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); g uuid;
 r jsonb; out jsonb := '[]'; price integer; student_count integer;
 people jsonb := '[{"name":"UAT Regresión Grupo Uno","phone":"9998878301"},{"name":"UAT Regresión Grupo Dos","phone":"9998878302"}]';
begin
 if not exists(select 1 from public.demi_uat_runs where studio_id=s) then raise exception 'sandbox_fixture_required'; end if;
 insert into public.assistant_conversations(id,studio_id,channel) values(c,s,'internal_demo');
 insert into public.class_sessions select (jsonb_populate_record(null::public.class_sessions,
  to_jsonb(x)||jsonb_build_object('id',sess,'starts_at',clock_timestamp()+interval '1 day','ends_at',clock_timestamp()+interval '1 day 1 hour','status','scheduled','requires_resource',true,'capacity',5,'notes','UAT regresión grupo: temporal, rollback'))).* 
 from public.class_sessions x where x.id='95c8ed36-a41d-4197-aa41-c113aadfc250' and x.studio_id=s;
 update public.class_sessions set requires_resource=true where id=sess and studio_id=s;
 select count(*) into student_count from public.students where studio_id=s;
 update public.class_sessions set requires_resource=false where id=sess and studio_id=s;
 r := public.service_prepare_demi_group(s,c,sess,2,2);
 if not coalesce((r->>'ok')::boolean,false) or r->>'status' is distinct from 'awaiting_receipt' then raise exception 'payment_preparation_failed:%',r; end if;
 g := (r->>'group_id')::uuid; price := (r->>'amount_minor')::integer;
 if exists(select 1 from public.reservations where session_id=sess) or (select count(*) from public.students where studio_id=s)<>student_count then raise exception 'payment_prepare_created_reservation_or_profile'; end if;
 out := out||jsonb_build_array(jsonb_build_object('case','GRP-02','variant','same_group_without_resource_prepare_only_payment','result',r,'passed',true,'new_reservations',0,'new_profiles',0));
 r := public.service_complete_demi_group(s,c,g,people);
 if r->>'reason_code' is distinct from 'receipt_required_before_participants' then raise exception 'pre_receipt_guard_failed:%',r; end if;
 if exists(select 1 from public.reservations where session_id=sess) or (select count(*) from public.students where studio_id=s)<>student_count then raise exception 'pre_receipt_created_data'; end if;
 out := out||jsonb_build_array(jsonb_build_object('case','GRP-03','variant','completion_before_receipt_rejected','result',r,'passed',true,'new_reservations',0,'new_profiles',0));
 insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint)
 values(ev,s,'meta_whatsapp','uat-regression-'||ev,'uat-capture-only','529990008301','image','uat-regression-media','uat-no-real-payment');
 r := public.service_record_demi_group_receipt(s,c,g,ev,'uat-regression-'||ev,'uat-regression-media','UAT/regression-no-real-payment.png',repeat('c',64),price,'MXN',0.99);
 if not coalesce((r->>'ok')::boolean,false) then raise exception 'synthetic_receipt_record_failed:%',r; end if;
 if exists(select 1 from public.reservations where session_id=sess) or (select count(*) from public.students where studio_id=s)<>student_count then raise exception 'receipt_alone_created_reservation_or_profile'; end if;
 out := out||jsonb_build_array(jsonb_build_object('case','GRP-04','variant','receipt_before_participant_details_creates_no_booking','result',r,'passed',true,'new_reservations',0,'new_profiles',0));
 r := public.service_complete_demi_group(s,c,g,'[{"name":"","phone":""},{"name":"","phone":""}]'::jsonb);
 if coalesce((r->>'ok')::boolean,false) or exists(select 1 from public.reservations where session_id=sess) then raise exception 'missing_details_created_booking:%',r; end if;
 out := out||jsonb_build_array(jsonb_build_object('case','GRP-05','variant','receipt_without_details_requests_missing_data','result',r,'passed',true,'new_reservations',0));
 r := public.service_complete_demi_group(s,c,g,people);
 if not coalesce((r->>'ok')::boolean,false) or (select count(*) from public.reservations where session_id=sess and status='reserved')<>2 then raise exception 'post_receipt_details_booking_failed:%',r; end if;
 out := out||jsonb_build_array(jsonb_build_object('case','GRP-06','variant','receipt_and_complete_details_create_two_reservations','result',r,'passed',true,'new_reservations',2,'synthetic_payment',true));
 perform set_config('uat.group_resource_regression',out::text,true);
end $$;
select current_setting('uat.group_resource_regression')::jsonb as results;
rollback;

