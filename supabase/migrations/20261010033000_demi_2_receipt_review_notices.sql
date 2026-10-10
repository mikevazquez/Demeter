-- Durable notices originate only from a completed staff review, never OCR.
create table public.demi_receipt_review_notices (
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id),conversation_id uuid not null references public.assistant_conversations(id),
 source_kind text not null check(source_kind in ('enrollment','transfer')),source_id uuid not null,decision text not null check(decision in ('approved','rejected')),
 notification_text text not null,amount_minor integer not null,currency text not null,
 notification_status text not null default 'pending' check(notification_status in ('pending','claimed','sent','review')),
 notification_lease uuid,notification_claimed_at timestamptz,notification_attempts integer not null default 0 check(notification_attempts between 0 and 3),notification_provider_id text,notification_error text,
 created_at timestamptz not null default clock_timestamp(),unique(studio_id,source_kind,source_id,decision)
);
alter table public.demi_receipt_review_notices enable row level security;
revoke all on public.demi_receipt_review_notices from public,anon,authenticated,service_role;
grant select,insert,update on public.demi_receipt_review_notices to service_role;
grant select on public.demi_receipt_review_notices to authenticated;
create policy receipt_review_notices_staff_read on public.demi_receipt_review_notices for select to authenticated using(private.has_capability(studio_id,'sales.read'));
create function private.queue_demi_receipt_review_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid; amount integer; currency_code text; message text; decision text; is_trial boolean;
begin
 if new.status is not distinct from old.status then return new; end if;
 if tg_table_name='demi_enrollment_receipts' then
  if new.status not in ('approved','rejected') then return new; end if;
  select conversation_id,amount_minor,currency into c,amount,currency_code from public.assistant_enrollment_intents where id=new.intent_id and studio_id=new.studio_id;
  decision:=new.status;
  message:=case when decision='approved' then 'El equipo validó tu pago de inscripción a Bancomer. Tu inscripción ya está activa; conservamos los créditos y el vencimiento de tu paquete. Podemos revisar la clase que quieres reservar.'
   else 'El equipo rechazó tu comprobante de inscripción. No se activó la inscripción por ese documento y conservamos tu paquete anterior. Motivo: '||coalesce(nullif(new.review_note,''),'el ingreso no pudo validarse')||'. Envía un comprobante nuevo y correcto para revisión.' end;
 else
  if new.status<>'rejected' then return new; end if;
  c:=new.conversation_id;amount:=new.amount_minor;currency_code:=new.currency;decision:='rejected';
  select exists(select 1 from public.trial_booking_policies where studio_id=new.studio_id and trial_payment_product_template_id=new.product_template_id) into is_trial;
  message:=case when is_trial then 'El equipo rechazó el comprobante de tu primera clase. La reserva condicionada a ese pago quedó cancelada y el crédito de ese pago ya no está disponible.'
   else 'El equipo rechazó el comprobante del paquete. Ese paquete provisional y sus reservas futuras quedaron cancelados; conservamos tus otros pagos y paquetes legítimos.' end
   ||' Motivo: '||coalesce(nullif(new.review_note,''),'el ingreso no pudo validarse')||'. Envía un comprobante nuevo y correcto para continuar; el documento rechazado permanece en tu historial.';
 end if;
 if not exists(select 1 from public.assistant_conversations where id=c and studio_id=new.studio_id) then raise exception 'review_notice_conversation_mismatch'; end if;
 insert into public.demi_receipt_review_notices(studio_id,conversation_id,source_kind,source_id,decision,notification_text,amount_minor,currency)
 values(new.studio_id,c,case when tg_table_name='demi_enrollment_receipts' then 'enrollment' else 'transfer' end,new.id,decision,message,amount,currency_code) on conflict do nothing;
 return new;
end $$;
revoke all on function private.queue_demi_receipt_review_notice() from public,anon,authenticated,service_role;
create trigger demi_enrollment_review_notice after update of status on public.demi_enrollment_receipts for each row execute function private.queue_demi_receipt_review_notice();
create trigger demi_transfer_review_notice after update of status on public.assistant_transfer_purchase_intents for each row execute function private.queue_demi_receipt_review_notice();
create function public.service_claim_demi_receipt_review_notices(p_studio uuid) returns setof public.demi_receipt_review_notices language plpgsql security invoker set search_path='' as $$
declare r public.demi_receipt_review_notices%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 for r in select * from public.demi_receipt_review_notices where studio_id=p_studio and notification_status='claimed' and notification_claimed_at<clock_timestamp()-interval '5 minutes' for update skip locked loop
  update public.demi_receipt_review_notices set notification_status='review',notification_error='delivery_outcome_unknown',notification_lease=null where id=r.id;
  perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'technical_block','Aviso de revisión de comprobante con entrega desconocida. No se reenvió a ciegas. Aviso: '||r.id);
 end loop;
 return query update public.demi_receipt_review_notices n set notification_status='claimed',notification_lease=gen_random_uuid(),notification_claimed_at=clock_timestamp(),notification_attempts=notification_attempts+1 where n.id in(
 select q.id from public.demi_receipt_review_notices q where q.studio_id=p_studio and q.notification_status='pending' and q.notification_attempts<3
 and not exists(select 1 from public.assistant_handoffs h where h.studio_id=p_studio and h.conversation_id=q.conversation_id and h.status='open')
 order by q.created_at for update skip locked limit 25) returning n.*;
end $$;
create function public.service_finish_demi_receipt_review_notice(p_request uuid,p_lease uuid,p_accepted boolean,p_provider text,p_error text,p_text text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.demi_receipt_review_notices%rowtype; result text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into r from public.demi_receipt_review_notices where id=p_request and notification_status='claimed' and notification_lease=p_lease for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','notification_lease_lost'); end if;
 if p_text is distinct from r.notification_text then raise exception 'review_notice_text_mismatch'; end if;
 if p_accepted and nullif(p_provider,'') is null then raise exception 'provider_confirmation_required'; end if;
 result:=case when p_accepted then 'sent' when r.notification_attempts>=3 or coalesce(p_error,'') not in ('meta_429','meta_425','demi_uat_injected_delivery_failure') then 'review' else 'pending' end;
 update public.demi_receipt_review_notices set notification_status=result,notification_lease=null,notification_error=p_error,notification_provider_id=p_provider where id=r.id;
 if p_accepted then insert into public.assistant_turns(studio_id,conversation_id,direction,role,content,channel_message_ref) values(r.studio_id,r.conversation_id,'outbound','assistant',r.notification_text,p_provider);
 elsif result='review' then perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'technical_block','No se entregó el aviso de revisión de comprobante. Aviso: '||r.id||'; resultado: '||coalesce(p_error,'unknown')); end if;
 return jsonb_build_object('ok',true,'status',result);
end $$;
revoke all on function public.service_claim_demi_receipt_review_notices(uuid),public.service_finish_demi_receipt_review_notice(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.service_claim_demi_receipt_review_notices(uuid),public.service_finish_demi_receipt_review_notice(uuid,uuid,boolean,text,text,text) to service_role;
select cron.schedule('studio_flow_demi_payments','*/5 * * * *',$cron$
 select net.http_post(url:=rtrim((select decrypted_secret from vault.decrypted_secrets where name='studio_flow_project_url' limit 1),'/')||'/functions/v1/demi-payment-worker',headers:=jsonb_build_object('Content-Type','application/json','x-studio-flow-dispatch-token',(select decrypted_secret from vault.decrypted_secrets where name='studio_flow_automation_dispatch_token' limit 1)),body:=jsonb_build_object('studio_id',s.studio_id),timeout_milliseconds:=30000)
 from (select studio_id from public.demi_mercadopago_settings where enabled union select studio_id from public.demi_receipt_review_notices where notification_status in ('pending','claimed')) s
 where not exists(select 1 from public.demi_uat_runs r where r.studio_id=s.studio_id);
$cron$);
