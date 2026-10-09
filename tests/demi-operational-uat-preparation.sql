begin;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare source uuid; owner uuid; run jsonb; studio uuid; run_id uuid; event uuid; identity jsonb; delivery jsonb; n integer; before_source integer;
begin
 select studio_id,user_id into source,owner from public.studio_memberships where active and studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' limit 1;
 select count(*) into before_source from public.students where studio_id=source;
 run:=public.service_create_demi_uat_run(source,owner,'preparation-sql');studio:=(run->>'studio_id')::uuid;run_id:=(run->>'id')::uuid;
 if studio=source then raise exception 'isolation_failed'; end if;
 select count(*) into n from public.class_sessions where studio_id=studio; if n<>6 then raise exception 'sessions_fixture_failed:%',n; end if;
 select count(*) into n from public.students where studio_id=studio; if n<>11 then raise exception 'students_fixture_failed:%',n; end if;
 if not coalesce((public.service_booking_eligibility(studio,(select id from public.class_sessions where studio_id=studio and notes='UAT available'),(select id from public.students where studio_id=studio and full_name='UAT student_active'))->>'eligible')::boolean,false) then raise exception 'active_package_fixture_ineligible'; end if;
 if not private.studio_has_module(studio,'notifications') then raise exception 'notifications_module_unavailable'; end if;
 if not public.service_acquire_demi_uat_run(run_id,owner,source) then raise exception 'lease_failed'; end if;
 if public.service_acquire_demi_uat_run(run_id,owner,source) then raise exception 'concurrent_lease_failed'; end if;
 update public.demi_uat_runs set faults='{"delivery_failures_remaining":1}' where id=run_id;
 delivery:=public.service_capture_demi_uat_delivery(studio,'preparation_capture','{"text":"Prueba"}'); if not (delivery->>'failed')::boolean then raise exception 'fault_injection_failed'; end if;
 delivery:=public.service_capture_demi_uat_delivery(studio,'preparation_capture','{"text":"Prueba"}'); if (delivery->>'failed')::boolean then raise exception 'fault_counter_failed'; end if;
 if public.service_capture_demi_uat_delivery(source,'preparation_capture','{}') is not null then raise exception 'source_capture_failed'; end if;
 insert into public.assistant_whatsapp_events(studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,body_preview,payload_fingerprint,processing_status)
 values(studio,'meta_whatsapp','uat-preparation-message','99900000001',run#>>'{fixtures,people,prospect,wa_id}','text','Hola, quiero información',md5(run_id::text),'captured') returning id into event;
 identity:=public.service_prepare_meta_whatsapp_message(studio,event,'uat-preparation-message',run#>>'{fixtures,people,prospect,wa_id}','UAT prospect','text','Hola, quiero información',clock_timestamp());
 if nullif(identity->>'assistant_conversation_id','') is null then raise exception 'real_identity_failed:%',identity; end if;
 if not exists(select 1 from public.crm_contacts where studio_id=studio) then raise exception 'real_crm_creation_failed'; end if;
 perform * from public.service_claim_demi_uat_jobs(studio,'uat-preparation',5,60);
 perform * from public.service_claim_demi_uat_deliveries(studio,'uat-preparation',5,60);
 if (select count(*) from public.students where studio_id=source)<>before_source then raise exception 'source_changed'; end if;
 raise notice 'Demi preparation: fixtures, module, lease, capture, faults, real identity and scoped claims verified';
end;
$$;
rollback;
