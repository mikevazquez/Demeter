create or replace function public.assistant_create_handoff(target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_reason_code text,target_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
 refs:=refs||jsonb_build_object(
  'group_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'group_id',r.group_id,'event_id',r.event_id,'storage_path',r.storage_path,'amount_minor',r.amount_minor,'currency',r.currency,'status',r.status)),'[]'::jsonb) from public.demi_group_receipts r where r.studio_id=c.studio_id and r.conversation_id=c.id),
  'reservations',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'session_id',r.session_id,'status',r.status)),'[]'::jsonb) from public.reservations r where r.studio_id=c.studio_id and r.student_id=c.student_id),
  'sales',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status)),'[]'::jsonb) from public.sales s where s.studio_id=c.studio_id and s.student_id=c.student_id),
  'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'sale_id',p.sale_id,'reservation_id',p.reservation_id)),'[]'::jsonb) from public.payments p join public.sales s on s.id=p.sale_id and s.studio_id=p.studio_id where p.studio_id=c.studio_id and s.student_id=c.student_id),
  'tool_errors',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'turn_id',e.turn_id,'tool_name',e.tool_name,'status',e.status)),'[]'::jsonb) from public.assistant_tool_executions e where e.studio_id=c.studio_id and e.conversation_id=c.id and e.status in ('error','blocked')));
 update public.assistant_handoffs set context=coalesce(context,'{}'::jsonb)||refs,note=case when note is null then nullif(left(trim(coalesce(target_note,'')),1000),'') when nullif(trim(coalesce(target_note,'')),'') is not null and position(trim(target_note) in note)=0 then left(note||E'\n'||trim(target_note),1000) else note end where id=h and studio_id=c.studio_id;
 return result||jsonb_build_object('references_saved',true);
end; $$;
