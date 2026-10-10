create or replace function public.service_record_demi_enrollment_receipt(p_studio uuid,p_conversation uuid,p_intent uuid,p_event uuid,p_provider text,p_path text,p_hash text,p_amount integer,p_currency text,p_confidence numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare intent public.assistant_enrollment_intents%rowtype; receipt public.demi_enrollment_receipts%rowtype; h jsonb; receipt_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into intent from public.assistant_enrollment_intents where id=p_intent and studio_id=p_studio and conversation_id=p_conversation and payment_method='bank_transfer' for update;
 if not found or not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio and student_id=intent.student_id) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if not exists(select 1 from public.assistant_whatsapp_events where id=p_event and studio_id=p_studio and provider_event_id=p_provider and assistant_conversation_id=p_conversation)
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
 h:=public.assistant_create_handoff(p_studio,p_conversation,intent.student_id,'technical_block','Comprobante de inscripción recibido. Validar ingreso a Bancomer antes de activar; no se reservó ni se modificó el paquete. Intención: '||intent.id);
 if coalesce((h->>'ok')::boolean,false) then update public.assistant_handoffs set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('enrollment_intent_id',intent.id,'enrollment_receipt_id',receipt.id) where id::text=h->>'handoff_id' and studio_id=p_studio; end if;
 return jsonb_build_object('ok',true,'status','human_review','receipt_id',receipt.id,'human_review_created',coalesce((h->>'ok')::boolean,false),'handoff_id',h->>'handoff_id','enrollment_activated',false,'reservation_confirmed',false,'package_preserved',true);
end; $$;
