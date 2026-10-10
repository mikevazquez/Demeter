-- Orders references accept letters, numbers, underscores and hyphens, not colons.
create or replace function public.service_prepare_demi_mercadopago(p_studio uuid,p_conversation uuid,p_group uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; r public.demi_payment_requests%rowtype; request_id uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.demi_mercadopago_settings where studio_id=p_studio and enabled) then return jsonb_build_object('ok',false,'reason_code','mercadopago_disabled'); end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 select * into r from public.demi_payment_requests where group_id=g.id;
 if found then return jsonb_build_object('ok',true,'request_id',r.id,'status',r.status,'external_reference',r.external_reference,'amount_minor',r.amount_minor,'currency',r.currency,'checkout_url',r.checkout_url,'provider_order_id',r.provider_order_id,'idempotent',true); end if;
 if g.status<>'awaiting_receipt' or g.receipt_event_id is not null or g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason_code','payment_not_awaiting_provider'); end if;
 if g.currency<>'MXN' then return jsonb_build_object('ok',false,'reason_code','unsupported_currency'); end if;
 if not exists(select 1 from public.class_sessions s where s.id=g.session_id and s.studio_id=p_studio and s.status='scheduled' and s.starts_at>clock_timestamp()+interval '30 minutes') then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 insert into public.demi_payment_requests(id,group_id,studio_id,conversation_id,amount_minor,currency,external_reference) values(request_id,g.id,p_studio,p_conversation,g.amount_minor,g.currency,'demi_'||request_id);
 return jsonb_build_object('ok',true,'request_id',request_id,'status','created','external_reference','demi_'||request_id,'amount_minor',g.amount_minor,'currency',g.currency);
end; $$;
update public.demi_payment_requests set external_reference='demi_'||id where external_reference like 'demi:%' and provider_order_id is null;
