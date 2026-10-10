create or replace function public.service_apply_demi_mercadopago_order(p_request uuid,p_order jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.demi_payment_requests%rowtype; payment jsonb; new_status text; amount numeric; paid numeric;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into r from public.demi_payment_requests where id=p_request for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','payment_request_not_found'); end if;
 -- A signed webhook/provider lookup can recover an order whose creation response
 -- was lost before persistence. Require the immutable reference, amount and currency.
 if r.provider_order_id is null and p_order->>'external_reference'=r.external_reference and nullif(p_order->>'id','') is not null and coalesce(p_order->>'total_amount','') ~ '^[0-9]+(\.[0-9]{1,2})?$' and upper(p_order->>'currency')=r.currency then
  if (p_order->>'total_amount')::numeric*100=r.amount_minor then
   update public.demi_payment_requests set provider_order_id=p_order->>'id' where id=r.id;
   r.provider_order_id:=p_order->>'id';
  end if;
 end if;
 if r.provider_order_id is null or p_order->>'id' is distinct from r.provider_order_id or p_order->>'external_reference' is distinct from r.external_reference then return jsonb_build_object('ok',false,'reason_code','provider_identity_mismatch'); end if;
 if p_order->>'status'='processed' and p_order->>'status_detail'='accredited' then
  if coalesce(p_order->>'total_amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or coalesce(p_order->>'total_paid_amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then return jsonb_build_object('ok',false,'reason_code','provider_amount_missing'); end if;
  amount:=(p_order->>'total_amount')::numeric*100; paid:=(p_order->>'total_paid_amount')::numeric*100;
  if amount<>r.amount_minor or paid<>r.amount_minor or upper(p_order->>'currency') is distinct from r.currency then return jsonb_build_object('ok',false,'reason_code','provider_amount_or_currency_mismatch'); end if;
  if jsonb_typeof(p_order#>'{transactions,payments}') is distinct from 'array' then return jsonb_build_object('ok',false,'reason_code','provider_payment_missing'); end if;
  select x into payment from jsonb_array_elements(p_order#>'{transactions,payments}') x where x->>'status'='processed' and x->>'status_detail'='accredited' and nullif(x->>'id','') is not null and coalesce(x->>'paid_amount',x->>'amount','') ~ '^[0-9]+(\.[0-9]{1,2})?$' and coalesce(x->>'paid_amount',x->>'amount')::numeric*100=r.amount_minor;
  if payment is null then return jsonb_build_object('ok',false,'reason_code','provider_payment_missing'); end if;
  if r.status='approved' then
   if r.provider_payment_id is distinct from payment->>'id' then return jsonb_build_object('ok',false,'reason_code','provider_payment_identity_changed'); end if;
   return jsonb_build_object('ok',true,'status','approved','idempotent',true,'request_id',r.id);
  end if;
  -- Uploaded proof and gateway proof must not pay the same group twice.
  if exists(select 1 from public.demi_group_bookings where id=r.group_id and (receipt_event_id is not null or status in ('provisional','validated','rejected'))) then
   perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'refund_request','Mercado Pago recibió un pago para una solicitud ya resuelta por otro medio. Revisar manualmente; no se aplicó un segundo pago. Solicitud: '||r.id);
   update public.demi_payment_requests set failure_code='payment_route_conflict',last_checked_at=clock_timestamp() where id=r.id;
   return jsonb_build_object('ok',false,'reason_code','payment_route_conflict');
  end if;
  update public.demi_payment_requests set status='approved',provider_payment_id=payment->>'id',verified_at=clock_timestamp(),last_checked_at=clock_timestamp(),provider_status='processed',provider_status_detail='accredited',failure_code=null,notification_status='pending' where id=r.id;
  update public.demi_group_bookings set status='awaiting_participants' where id=r.group_id and status='awaiting_receipt';
  return jsonb_build_object('ok',true,'status','approved','request_id',r.id,'participant_data_required',true,'reservation_confirmed',false);
 end if;
 if r.status='approved' then
  if p_order->>'status' in ('refunded','charged_back','canceled','cancelled') then perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'refund_request','Cambio posterior al pago aprobado de Mercado Pago: '||r.id||'. Revisar manualmente; no se revocaron derechos automáticamente.'); end if;
  return jsonb_build_object('ok',true,'status','approved','idempotent',true);
 end if;
 new_status:=case when p_order->>'status'='created' then 'order_created' when p_order->>'status' in ('pending','processing','action_required','authorized','in_process') then 'pending' when p_order->>'status' in ('failed','rejected') then 'rejected' when p_order->>'status' in ('canceled','cancelled','refunded','charged_back') then 'cancelled' else 'error' end;
 update public.demi_payment_requests set status=new_status,provider_status=p_order->>'status',provider_status_detail=p_order->>'status_detail',last_checked_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('ok',true,'status',new_status,'reservation_confirmed',false);
end; $$;
