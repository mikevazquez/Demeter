-- Fault flags come exclusively from a service-owned synthetic UAT run, never from user text.
create or replace function public.service_demi_booking_failure_status(p_studio uuid,p_conversation uuid,p_pending uuid,p_turn uuid,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.assistant_pending_actions%rowtype; c public.assistant_conversations%rowtype; student uuid; session uuid; n integer; maximum integer; resumed timestamptz; h jsonb; uat_baseline jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 select * into a from public.assistant_pending_actions where id=p_pending and studio_id=p_studio and conversation_id=p_conversation and action_type='booking.create';
 if c.id is null or a.id is null or not exists(select 1 from public.assistant_turns where id=p_turn and studio_id=p_studio and conversation_id=p_conversation) then return jsonb_build_object('ok',false,'reason_code','operation_scope_mismatch'); end if;
 student:=nullif(a.action_payload->>'student_id','')::uuid; session:=nullif(a.action_payload->>'session_id','')::uuid;
 if not exists(select 1 from public.class_sessions where id=session and studio_id=p_studio) or (student is not null and (c.student_id is distinct from student or not exists(select 1 from public.students where id=student and studio_id=p_studio))) then return jsonb_build_object('ok',false,'reason_code','operation_identity_mismatch'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text||session::text||coalesce(student::text,''),0));
 select booking_failure_limit into maximum from public.demi_operation_retry_settings where studio_id=p_studio;
 maximum:=coalesce(maximum,3);
 select max(resolved_at) into resumed from public.assistant_handoffs where studio_id=p_studio and conversation_id=p_conversation and status='resolved' and reason_code='technical_block';
 select count(*) into n from public.demi_booking_failures where studio_id=p_studio and conversation_id=p_conversation and session_id=session and student_id is not distinct from student and (resumed is null or created_at>resumed);
 if p_error is not null and n<maximum then
  insert into public.demi_booking_failures(studio_id,conversation_id,pending_id,turn_id,student_id,session_id,error_code)
  values(p_studio,p_conversation,p_pending,p_turn,student,session,left(p_error,128)) on conflict(pending_id,turn_id) do nothing;
  select count(*) into n from public.demi_booking_failures where studio_id=p_studio and conversation_id=p_conversation and session_id=session and student_id is not distinct from student and (resumed is null or created_at>resumed);
 end if;
 if n>=maximum then
  h:=public.assistant_create_handoff(p_studio,p_conversation,student,'technical_block','Reserva con límite de fallos agotado. Intentos: '||n||'; límite configurado: '||maximum||'; acción: '||p_pending||'; sesión: '||session||'; último error: '||coalesce(p_error,'persistido'));
  if h->>'ok'<>'true' then return jsonb_build_object('ok',false,'reason_code','operation_handoff_failed','attempt_count',n,'attempt_limit',maximum); end if;
 end if;
 select baseline into uat_baseline from public.demi_uat_runs where studio_id=p_studio;
 return jsonb_build_object('inject_failure_before',coalesce((uat_baseline->>'booking_uat_failure_before')::boolean,false),'inject_timeout_after',coalesce((uat_baseline->>'booking_uat_timeout_after')::boolean,false),'ok',true,'retry_allowed',n<maximum,'attempt_count',n,'attempt_limit',maximum,'handoff_id',h->>'handoff_id');
end; $$;
