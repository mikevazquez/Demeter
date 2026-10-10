alter table public.assistant_enrollment_intents add column if not exists reviewed_sale_id uuid references public.sales(id);
create table public.demi_enrollment_receipts (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 intent_id uuid not null references public.assistant_enrollment_intents(id),
 event_id uuid not null references public.assistant_whatsapp_events(id),
 provider_message_id text not null, storage_path text not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 detected_amount_minor integer, detected_currency text, read_confidence numeric,
 status text not null check(status in ('received','unreadable','amount_mismatch','approved','rejected')),
 review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), unique(studio_id,sha256),unique(studio_id,event_id)
);
create index demi_enrollment_receipts_intent on public.demi_enrollment_receipts(intent_id);
alter table public.demi_enrollment_receipts enable row level security;
revoke all on public.demi_enrollment_receipts from public,anon,authenticated,service_role;
grant select,insert on public.demi_enrollment_receipts to service_role;
grant select on public.demi_enrollment_receipts to authenticated;
create policy demi_enrollment_receipts_staff_read on public.demi_enrollment_receipts for select to authenticated using(private.has_capability(studio_id,'sales.read'));

create function public.service_prepare_demi_enrollment_payment(p_studio uuid,p_conversation uuid,p_student uuid,p_method text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare student public.students%rowtype; policy public.enrollment_policies%rowtype; product public.product_templates%rowtype;
 intent public.assistant_enrollment_intents%rowtype; bank public.studio_bank_transfer_settings%rowtype; today date;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if p_method not in ('bank_transfer','app') then return jsonb_build_object('ok',false,'reason_code','enrollment_payment_method_invalid'); end if;
 select * into student from public.students where id=p_student and studio_id=p_studio and active and lifecycle_status='active' for update;
 if not found or not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio and student_id=p_student) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if student.student_type='trial' and student.trial_status is distinct from 'attended'::public.trial_status then return jsonb_build_object('ok',false,'reason_code','trial_attendance_required'); end if;
 select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=p_studio;
 if exists(select 1 from public.student_enrollments where studio_id=p_studio and student_id=p_student and refunded_at is null and status='active' and starts_on<=today and (expires_on is null or expires_on>today)) then
  return jsonb_build_object('ok',false,'reason_code','enrollment_already_active'); end if;
 select * into policy from public.enrollment_policies where studio_id=p_studio and enabled;
 select * into product from public.product_templates where id=policy.enrollment_product_template_id and studio_id=p_studio and active and product_type='enrollment' and assistant_visible is distinct from false and price_minor>0;
 if not found then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
 if p_method='app' and not product.online_purchasable then return jsonb_build_object('ok',false,'reason_code','enrollment_online_checkout_unavailable'); end if;
 if p_method='bank_transfer' then
  select * into bank from public.studio_bank_transfer_settings where studio_id=p_studio and enabled;
  if not found or not exists(select 1 from public.studio_payment_methods where studio_id=p_studio and code='bank_transfer' and active) then return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available'); end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_conversation::text||':enrollment',0));
 select * into intent from public.assistant_enrollment_intents where studio_id=p_studio and conversation_id=p_conversation and student_id=p_student and payment_method=p_method and status in ('receipt_required','online_pending','human_review') order by created_at desc limit 1 for update;
 if not found then
  insert into public.assistant_enrollment_intents(studio_id,conversation_id,student_id,enrollment_product_template_id,payment_method,status,amount_minor,currency)
   values(p_studio,p_conversation,p_student,product.id,p_method,case when p_method='app' then 'online_pending' else 'receipt_required' end,product.price_minor,product.currency) returning * into intent;
 end if;
 return jsonb_build_object('ok',true,'intent_id',intent.id,'status',intent.status,'amount_minor',intent.amount_minor,'currency',intent.currency,
  'product_ref','product:'||intent.enrollment_product_template_id,'payment_method',p_method,'receipt_required',p_method='bank_transfer','enrollment_activated',false,'reservation_confirmed',false,'package_preserved',true,
  'bank_details',case when p_method='bank_transfer' then jsonb_build_object('bank_name',bank.bank_name,'account_holder',bank.account_holder,'clabe',bank.clabe,'account_number',bank.account_number,'card_number',bank.card_number,'instructions',bank.instructions) else null end);
end; $$;
revoke all on function public.service_prepare_demi_enrollment_payment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_prepare_demi_enrollment_payment(uuid,uuid,uuid,text) to service_role;

create function public.service_record_demi_enrollment_receipt(p_studio uuid,p_conversation uuid,p_intent uuid,p_event uuid,p_provider text,p_path text,p_hash text,p_amount integer,p_currency text,p_confidence numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare intent public.assistant_enrollment_intents%rowtype; receipt public.demi_enrollment_receipts%rowtype; h jsonb; receipt_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into intent from public.assistant_enrollment_intents where id=p_intent and studio_id=p_studio and conversation_id=p_conversation and payment_method='bank_transfer' for update;
 if not found or not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio and student_id=intent.student_id) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if not exists(select 1 from public.assistant_whatsapp_events where id=p_event and studio_id=p_studio and provider_event_id=p_provider)
  or p_path not like p_studio::text||'/enrollment/'||intent.id::text||'/%' or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'reason_code','receipt_source_mismatch'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_studio::text||p_hash,0));
 select * into receipt from public.demi_enrollment_receipts where studio_id=p_studio and (sha256=p_hash or event_id=p_event);
 if found then
  if receipt.intent_id<>intent.id then return jsonb_build_object('ok',false,'reason_code','receipt_already_used'); end if;
  return jsonb_build_object('ok',receipt.status in ('received','approved'),'receipt_id',receipt.id,'status',receipt.status,'idempotent',true,'enrollment_activated',receipt.status='approved'); end if;
 if intent.status not in ('receipt_required','rejected','human_review') then return jsonb_build_object('ok',false,'reason_code','enrollment_receipt_not_expected'); end if;
 receipt_status:=case when p_amount is null or coalesce(p_confidence,0)<0.8 then 'unreadable' when p_amount<>intent.amount_minor or p_currency is distinct from intent.currency then 'amount_mismatch' else 'received' end;
 insert into public.demi_enrollment_receipts(studio_id,intent_id,event_id,provider_message_id,storage_path,sha256,detected_amount_minor,detected_currency,read_confidence,status)
  values(p_studio,intent.id,p_event,p_provider,p_path,p_hash,p_amount,p_currency,p_confidence,receipt_status) returning * into receipt;
 if receipt_status<>'received' then return jsonb_build_object('ok',false,'receipt_id',receipt.id,'reason_code','receipt_'||receipt_status,'enrollment_activated',false); end if;
 update public.assistant_enrollment_intents set status='human_review',receipt_reference=receipt.id::text,updated_at=clock_timestamp() where id=intent.id;
 h:=public.assistant_create_handoff(p_studio,p_conversation,intent.student_id,'transfer_receipt_review','Comprobante de inscripción recibido. Validar ingreso a Bancomer antes de activar; no se reservó ni se modificó el paquete. Intención: '||intent.id);
 if coalesce((h->>'ok')::boolean,false) then update public.assistant_handoffs set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('enrollment_intent_id',intent.id,'enrollment_receipt_id',receipt.id) where id::text=h->>'handoff_id' and studio_id=p_studio; end if;
 return jsonb_build_object('ok',true,'status','human_review','receipt_id',receipt.id,'human_review_created',coalesce((h->>'ok')::boolean,false),'handoff_id',h->>'handoff_id','enrollment_activated',false,'reservation_confirmed',false,'package_preserved',true);
end; $$;
revoke all on function public.service_record_demi_enrollment_receipt(uuid,uuid,uuid,uuid,text,text,text,integer,text,numeric) from public,anon,authenticated;
grant execute on function public.service_record_demi_enrollment_receipt(uuid,uuid,uuid,uuid,text,text,text,integer,text,numeric) to service_role;

create function public.admin_review_demi_enrollment_receipt(p_studio uuid,p_receipt uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.demi_enrollment_receipts%rowtype; intent public.assistant_enrollment_intents%rowtype; product public.product_templates%rowtype; sale jsonb; today date;
begin
 if auth.uid() is null or not private.has_capability(p_studio,'sales.write') then raise exception 'forbidden'; end if;
 if p_decision not in ('approved','rejected') or length(trim(coalesce(p_note,'')))<3 then return jsonb_build_object('ok',false,'reason_code','review_note_required'); end if;
 select * into receipt from public.demi_enrollment_receipts where id=p_receipt and studio_id=p_studio for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','receipt_not_found'); end if;
 select * into intent from public.assistant_enrollment_intents where id=receipt.intent_id and studio_id=p_studio for update;
 if receipt.status=p_decision then return jsonb_build_object('ok',true,'status',p_decision,'idempotent',true,'sale_id',intent.reviewed_sale_id); end if;
 if receipt.status<>'received' or intent.status<>'human_review' or intent.receipt_reference<>receipt.id::text then return jsonb_build_object('ok',false,'reason_code','receipt_not_reviewable'); end if;
 if p_decision='approved' then
  select * into product from public.product_templates where id=intent.enrollment_product_template_id and studio_id=p_studio and active and product_type='enrollment';
  if not found or product.price_minor<>intent.amount_minor or product.currency<>intent.currency then return jsonb_build_object('ok',false,'reason_code','enrollment_price_changed_requires_review'); end if;
  if receipt.detected_amount_minor<>intent.amount_minor or receipt.detected_currency is distinct from intent.currency then return jsonb_build_object('ok',false,'reason_code','receipt_amount_mismatch'); end if;
  select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=p_studio;
  sale:=public.create_manual_sale(intent.student_id,array[intent.enrollment_product_template_id],intent.amount_minor,'bank_transfer',receipt.provider_message_id,'Inscripción validada manualmente por comprobante de Demi: '||trim(p_note),today);
  if sale->>'sale_id' is null then raise exception 'enrollment_sale_failed'; end if;
  update public.assistant_enrollment_intents set status='approved',reviewed_sale_id=(sale->>'sale_id')::uuid,updated_at=clock_timestamp() where id=intent.id;
 else update public.assistant_enrollment_intents set status='rejected',updated_at=clock_timestamp() where id=intent.id; end if;
 update public.demi_enrollment_receipts set status=p_decision,review_note=left(trim(p_note),2000),reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=receipt.id;
 return jsonb_build_object('ok',true,'status',p_decision,'sale_id',sale->>'sale_id','enrollment_activated',p_decision='approved','package_preserved',true);
end; $$;
revoke all on function public.admin_review_demi_enrollment_receipt(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.admin_review_demi_enrollment_receipt(uuid,uuid,text,text) to authenticated;
