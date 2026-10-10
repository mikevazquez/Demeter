-- Scope the existing handoff writer and attach financial/booking references for manual resolution.
alter table public.assistant_handoffs add column context jsonb not null default '{}'::jsonb;
alter function public.assistant_create_handoff(uuid,uuid,uuid,text,text) set schema private;
alter function private.assistant_create_handoff(uuid,uuid,uuid,text,text) rename to assistant_create_handoff_base;
revoke all on function private.assistant_create_handoff_base(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.assistant_create_handoff(target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_reason_code text,target_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype; result jsonb; refs jsonb; h uuid;
begin
 if auth.role() is distinct from 'service_role' and (auth.uid() is null or not private.has_capability(target_studio_id,'settings.write')) then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=target_conversation_id and studio_id=target_studio_id;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if target_student_id is not null and (c.student_id is distinct from target_student_id or not exists(select 1 from public.students where id=target_student_id and studio_id=target_studio_id)) then return jsonb_build_object('ok',false,'reason_code','student_identity_mismatch'); end if;
 result:=private.assistant_create_handoff_base(target_studio_id,target_conversation_id,target_student_id,target_reason_code,target_note);
 if result->>'ok'<>'true' then return result; end if;
 h:=(result->>'handoff_id')::uuid;
 refs:=jsonb_build_object('conversation_id',c.id,'student_id',c.student_id,'crm_contact_id',c.context->>'crm_contact_id',
  'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'session_id',g.session_id,'status',g.status,'receipt_event_id',g.receipt_event_id)),'[]'::jsonb) from public.demi_group_bookings g where g.studio_id=c.studio_id and g.conversation_id=c.id),
  'payment_requests',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'provider_order_id',r.provider_order_id,'provider_payment_id',r.provider_payment_id,'amount_minor',r.amount_minor,'currency',r.currency)),'[]'::jsonb) from public.demi_payment_requests r where r.studio_id=c.studio_id and r.conversation_id=c.id),
  'transfer_intents',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'sale_id',i.sale_id,'reservation_id',i.reservation_id)),'[]'::jsonb) from public.assistant_transfer_purchase_intents i where i.studio_id=c.studio_id and (i.conversation_id=c.id or exists(select 1 from public.demi_group_participants p join public.demi_group_bookings g on g.id=p.group_id where p.transfer_intent_id=i.id and g.studio_id=c.studio_id and g.conversation_id=c.id))));
 update public.assistant_handoffs set context=refs,note=case when note is null then nullif(left(trim(coalesce(target_note,'')),1000),'') when nullif(trim(coalesce(target_note,'')),'') is not null and position(trim(target_note) in note)=0 then left(note||E'\n'||trim(target_note),1000) else note end where id=h and studio_id=c.studio_id;
 return result||jsonb_build_object('references_saved',true);
end; $$;
revoke all on function public.assistant_create_handoff(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.assistant_create_handoff(uuid,uuid,uuid,text,text) to authenticated,service_role;
