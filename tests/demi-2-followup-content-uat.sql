begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
set local request.jwt.claim.role='service_role';
do $$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; run jsonb; s uuid; person uuid; contact uuid;
 c uuid; g uuid; event uuid; session uuid; r jsonb; f public.demi_followups%rowtype; t timestamptz:=clock_timestamp(); results jsonb:='[]'; idx integer; test_now timestamptz;
begin
 select user_id into owner from public.studio_memberships where studio_id=source and role='owner' and active limit 1;
 run:=public.service_create_demi_uat_run(source,owner,'followup-content');s:=(run->>'studio_id')::uuid;
 person:=(run#>>'{fixtures,people,prospect_existing,person_id}')::uuid;
 session:=(run#>>'{fixtures,sessions,available}')::uuid;
 select id into contact from public.crm_contacts where studio_id=s and person_id=person;
 for idx in 1..3 loop
  c:=gen_random_uuid();insert into public.assistant_conversations(id,studio_id,channel,context) values(c,s,'whatsapp',jsonb_build_object('crm_contact_id',contact));
  if idx>1 then
   r:=public.service_prepare_demi_group(s,c,session,2,2);
   if r->>'ok'<>'true' then raise exception 'group_prepare:%',r; end if;
   g:=(r->>'group_id')::uuid;
  end if;
  if idx=3 then
   event:=gen_random_uuid();
   insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint)
    values(event,s,'meta_whatsapp','content-'||event,'uat','99900000000','image','content-media','content-uat');
   r:=public.service_record_demi_group_receipt(s,c,g,event,'content-'||event,'content-media','UAT/content.png',repeat('b',64),30000,'MXN',0.99);
   if r->>'ok'<>'true' then raise exception 'content_receipt:%',r; end if;
   insert into public.assistant_tool_executions(studio_id,conversation_id,tool_call_id,tool_name,schema_version,permission_class,request_json,result_json,status)
    values(s,c,'uat-missing-field','complete_group_booking',1,'B',jsonb_build_object('group_id',g,'participants',jsonb_build_array(jsonb_build_object('name','Ana UAT','phone','9998885001'),jsonb_build_object('name','Beto UAT','phone',''))),jsonb_build_object('reason_code','participant_data_required'),'blocked');
  end if;
  r:=public.service_schedule_demi_followups(s,c,'prospect','content-'||idx,t);
  test_now:=case when idx=2 then (select created_at+interval '2 hours' from public.demi_group_bookings where id=g) else t+interval '1 day' end;
  select * into f from public.service_claim_demi_followups(s,test_now,25) where conversation_id=c;
  if f.id is null then raise exception 'content_not_claimed'; end if;
  r:=public.service_get_demi_followup_message(f.id,f.lease_token,test_now);
  if r->>'ok'<>'true' then raise exception 'content_failed:%',r; end if;
  if idx=1 and (r->>'stage'<>'information' or r->>'text' not like '%horarios%') then raise exception 'information_content:%',r; end if;
  if idx=2 and (r->>'stage'<>'awaiting_receipt' or r->>'text' not like '%comprobante%' or r->>'text' like '%nombre completo%') then raise exception 'receipt_content:%',r; end if;
  if idx=3 and (r->>'stage'<>'awaiting_participants' or r->>'text' not like '%celular de diez dígitos de la persona 2%' or r->>'text' like '%nombre completo%' or r->>'text' like '%comprobante%') then raise exception 'missing_only_content:%',r; end if;
  results:=results||jsonb_build_array(jsonb_build_object('variant',r->>'stage','text',r->>'text','template_key',r->>'template_key','passed',true));
  r:=public.service_get_demi_followup_message(f.id,gen_random_uuid(),test_now);
  if r->>'reason_code'<>'lease_mismatch' then raise exception 'foreign_lease_content'; end if;
  r:=public.service_finish_demi_followup(f.id,f.lease_token,true,'content:'||idx,null,test_now);
  update public.demi_followups set state='cancelled' where studio_id=s and conversation_id=c and state='pending';
 end loop;
 results:=results||jsonb_build_array(jsonb_build_object('variant','wrong_lease_cannot_read_message_context','passed',true));
 perform set_config('uat.followup_content_results',results::text,true);
end $$;
select current_setting('uat.followup_content_results')::jsonb as results;
rollback;
