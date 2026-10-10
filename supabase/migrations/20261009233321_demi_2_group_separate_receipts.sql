-- Documents are evidence for manual bank review, never provider payment approval.
create table public.demi_group_receipts (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 group_id uuid not null references public.demi_group_bookings(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 event_id uuid not null references public.assistant_whatsapp_events(id),
 provider_id text not null,
 media_id text not null,
 storage_path text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 amount_minor integer,
 currency text,
 confidence numeric not null,
 status text not null check(status in ('received','unreadable','amount_mismatch')),
 created_at timestamptz not null default clock_timestamp(),
 unique(studio_id,sha256), unique(studio_id,event_id)
);
create index demi_group_receipts_group on public.demi_group_receipts(group_id);
create index demi_group_receipts_conversation on public.demi_group_receipts(conversation_id);
create index demi_group_receipts_event on public.demi_group_receipts(event_id);
alter table public.demi_group_receipts enable row level security;
revoke all on public.demi_group_receipts from public,anon,authenticated;
grant select on public.demi_group_receipts to authenticated;
grant select,insert on public.demi_group_receipts to service_role;
create policy demi_group_receipts_staff_read on public.demi_group_receipts for select to authenticated
using(private.has_capability(studio_id,'sales.read'));
insert into public.demi_group_receipts(studio_id,group_id,conversation_id,event_id,provider_id,media_id,storage_path,sha256,amount_minor,currency,confidence,status)
select studio_id,id,conversation_id,receipt_event_id,receipt_provider_id,receipt_media_id,receipt_path,receipt_sha256,amount_minor,currency,1,'received'
from public.demi_group_bookings where receipt_event_id is not null and receipt_sha256 ~ '^[0-9a-f]{64}$' and receipt_path is not null and receipt_provider_id is not null and receipt_media_id is not null;

create or replace function public.service_record_demi_group_receipt(p_studio uuid,p_conversation uuid,p_group uuid,p_event uuid,p_provider text,p_media text,p_path text,p_hash text,p_amount integer,p_currency text,p_confidence numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; previous public.demi_group_receipts%rowtype; total bigint; document_status text; replay boolean:=false;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if not exists(select 1 from public.assistant_whatsapp_events where id=p_event and studio_id=p_studio and provider_event_id=p_provider and media_id=p_media and (assistant_conversation_id is null or assistant_conversation_id=p_conversation)) then return jsonb_build_object('ok',false,'reason_code','receipt_event_mismatch'); end if;
 if nullif(p_path,'') is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'reason_code','receipt_storage_required'); end if;
 -- Serialize allocations of the same bytes across different groups.
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_hash,0));
 select * into previous from public.demi_group_receipts where studio_id=p_studio and (sha256=p_hash or event_id=p_event) order by created_at limit 1;
 if found then
  if previous.group_id<>g.id then return jsonb_build_object('ok',false,'reason_code','receipt_already_allocated'); end if;
  if previous.sha256<>p_hash or previous.amount_minor is distinct from p_amount or previous.currency is distinct from p_currency then return jsonb_build_object('ok',false,'reason_code','receipt_content_changed'); end if;
  replay:=true; document_status:=previous.status;
 else
  if g.status<>'awaiting_receipt' or g.receipt_event_id is not null then return jsonb_build_object('ok',false,'reason_code','group_already_has_receipt','status',g.status); end if;
  if g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason_code','group_expired'); end if;
  if exists(select 1 from public.demi_group_bookings where studio_id=p_studio and receipt_sha256=p_hash and id<>g.id)
   or exists(select 1 from public.assistant_transfer_purchase_intents where studio_id=p_studio and receipt_event_id=p_event) then return jsonb_build_object('ok',false,'reason_code','receipt_already_allocated'); end if;
  select coalesce(sum(amount_minor),0) into total from public.demi_group_receipts where group_id=g.id and status='received';
  document_status:=case when coalesce(p_confidence,0)<0.75 or coalesce(p_amount,0)<=0 then 'unreadable' when p_currency is distinct from g.currency or total+p_amount>g.amount_minor then 'amount_mismatch' else 'received' end;
  insert into public.demi_group_receipts(studio_id,group_id,conversation_id,event_id,provider_id,media_id,storage_path,sha256,amount_minor,currency,confidence,status)
  values(p_studio,g.id,p_conversation,p_event,p_provider,p_media,p_path,p_hash,p_amount,p_currency,coalesce(p_confidence,0),document_status);
 end if;
 select coalesce(sum(amount_minor),0) into total from public.demi_group_receipts where group_id=g.id and status='received';
 if document_status<>'received' then return jsonb_build_object('ok',false,'reason_code',case when document_status='unreadable' then 'receipt_unreadable' else 'receipt_amount_mismatch' end,'received_amount_minor',total,'remaining_amount_minor',g.amount_minor-total,'expected_amount_minor',g.amount_minor,'document_preserved',true,'idempotent',replay); end if;
 if total<g.amount_minor then return jsonb_build_object('ok',false,'reason_code','partial_payment_received','status',g.status,'received_amount_minor',total,'remaining_amount_minor',g.amount_minor-total,'payment_validation_required',true,'reservation_confirmed',false,'idempotent',replay); end if;
 if g.receipt_event_id is null then
  update public.demi_group_bookings set receipt_event_id=p_event,receipt_provider_id=p_provider,receipt_media_id=p_media,receipt_path=p_path,receipt_sha256=p_hash,status='awaiting_participants' where id=g.id;
  g.status:='awaiting_participants';
 end if;
 return jsonb_build_object('ok',true,'status',g.status,'received_amount_minor',total,'payment_validation_required',true,'reservation_confirmed',false,'idempotent',replay);
end; $$;

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
 update public.assistant_handoffs set context=refs,note=case when note is null then nullif(left(trim(coalesce(target_note,'')),1000),'') when nullif(trim(coalesce(target_note,'')),'') is not null and position(trim(target_note) in note)=0 then left(note||E'\n'||trim(target_note),1000) else note end where id=h and studio_id=c.studio_id;
 return result||jsonb_build_object('references_saved',true);
end; $$;
