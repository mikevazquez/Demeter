begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare owner uuid; run jsonb; s uuid; student uuid; session uuid; c uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid(); turn uuid; first_turn uuid; r jsonb; h uuid; i integer;
begin
 select user_id into owner from public.studio_memberships where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772' and active and role='owner' limit 1;
 run:=public.service_create_demi_uat_run('9fe23cfa-fb47-4670-afeb-ed4a56433772',owner,'M09-failure-tracking'); s:=(run->>'studio_id')::uuid;
 student:=(run#>>'{fixtures,people,student_active,student_id}')::uuid; session:=(run#>>'{fixtures,sessions,available}')::uuid;
 insert into public.demi_operation_retry_settings(studio_id,booking_failure_limit) values(s,3);
 insert into public.assistant_conversations(id,studio_id,student_id,channel) values(c,s,student,'internal_demo');
 insert into public.assistant_pending_actions(id,studio_id,conversation_id,action_type,action_token_hash,action_payload,confirmation_summary,status,expires_at)
 values(pending,s,c,'booking.create',md5(pending::text)||md5(c::text),jsonb_build_object('student_id',student,'session_id',session),'{}','pending',clock_timestamp()+interval '10 minutes');
 for i in 1..3 loop
  turn:=gen_random_uuid(); if i=1 then first_turn:=turn; end if;
  insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content) values(turn,s,c,'inbound','user','UAT confirmación');
  r:=public.service_demi_booking_failure_status(s,c,pending,turn,null);
  if r->>'attempt_count'<>(i-1)::text or r->>'attempt_limit'<>'3' then raise exception 'attempt_precheck:%',r; end if;
  r:=public.service_demi_booking_failure_status(s,c,pending,turn,'booking_execution_failed');
  if r->>'attempt_count'<>i::text then raise exception 'attempt_count:%',r; end if;
  r:=public.service_demi_booking_failure_status(s,c,pending,turn,'booking_execution_failed');
  if r->>'attempt_count'<>i::text then raise exception 'failure_duplicate'; end if;
 end loop;
 if r->>'retry_allowed'<>'false' or r->>'handoff_id' is null then raise exception 'no_handoff_after_limit:%',r; end if;
 h:=(r->>'handoff_id')::uuid;
 turn:=gen_random_uuid();insert into public.assistant_turns(id,studio_id,conversation_id,direction,role,content) values(turn,s,c,'inbound','user','UAT cuarto intento');
 r:=public.service_demi_booking_failure_status(s,c,pending,turn,'booking_execution_failed');
 if r->>'attempt_count'<>'3' or (select count(*) from public.demi_booking_failures where studio_id=s)<>3 then raise exception 'fourth_attempt'; end if;
 r:=public.service_demi_booking_failure_status('9fe23cfa-fb47-4670-afeb-ed4a56433772',c,pending,first_turn,'booking_execution_failed');
 if r->>'reason_code'<>'operation_scope_mismatch' then raise exception 'foreign_studio'; end if;
 r:=public.service_demi_booking_failure_status(s,c,pending,gen_random_uuid(),'booking_execution_failed');
 if r->>'reason_code'<>'operation_scope_mismatch' then raise exception 'foreign_turn'; end if;
 if has_function_privilege('anon','public.service_demi_booking_failure_status(uuid,uuid,uuid,uuid,text)','EXECUTE') or has_table_privilege('authenticated','public.demi_booking_failures','INSERT') then raise exception 'failure_permissions'; end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',owner)::text,true);
 r:=public.admin_resolve_demi_handoff(s,h,'Equipo corrigió el fallo y devolvió control.');
 if r->>'ok'<>'true' then raise exception 'human_resolution:%',r; end if;
 r:=public.service_demi_booking_failure_status(s,c,pending,turn,null);
 if r->>'attempt_count'<>'0' or r->>'retry_allowed'<>'true' or (select count(*) from public.demi_booking_failures where studio_id=s)<>3 then raise exception 'resume_lost_audit_or_blocked:%',r; end if;
end $$;
select 'passed' as result, 'actual service_role; configured limit 3; deduplicated attempts; scope; human resolution retains audit' as scope;
rollback;
