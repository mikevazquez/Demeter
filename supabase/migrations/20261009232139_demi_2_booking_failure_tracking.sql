create table public.demi_operation_retry_settings (
 studio_id uuid primary key references public.studios(id),
 booking_failure_limit integer not null default 3 check(booking_failure_limit between 1 and 5)
);
create table public.demi_booking_failures (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 pending_id uuid not null references public.assistant_pending_actions(id),
 turn_id uuid not null references public.assistant_turns(id),
 student_id uuid references public.students(id),
 session_id uuid not null references public.class_sessions(id),
 error_code text not null check(length(error_code) between 1 and 128),
 created_at timestamptz not null default clock_timestamp(),
 unique(pending_id,turn_id)
);
create index demi_booking_failures_operation on public.demi_booking_failures(studio_id,conversation_id,session_id,student_id,created_at);
alter table public.demi_operation_retry_settings enable row level security;
alter table public.demi_booking_failures enable row level security;
revoke all on public.demi_operation_retry_settings,public.demi_booking_failures from public,anon,authenticated;
grant select,insert,update on public.demi_operation_retry_settings to service_role;
grant select,insert on public.demi_booking_failures to service_role;
create policy demi_retry_settings_service on public.demi_operation_retry_settings to service_role using(true) with check(true);
create policy demi_booking_failures_service on public.demi_booking_failures to service_role using(true) with check(true);

create function public.service_demi_booking_failure_status(p_studio uuid,p_conversation uuid,p_pending uuid,p_turn uuid,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.assistant_pending_actions%rowtype; c public.assistant_conversations%rowtype; student uuid; session uuid; n integer; maximum integer; resumed timestamptz; h jsonb;
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
 return jsonb_build_object('ok',true,'retry_allowed',n<maximum,'attempt_count',n,'attempt_limit',maximum,'handoff_id',h->>'handoff_id');
end; $$;
revoke all on function public.service_demi_booking_failure_status(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_demi_booking_failure_status(uuid,uuid,uuid,uuid,text) to service_role;
