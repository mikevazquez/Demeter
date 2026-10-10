create function public.service_claim_demi_payment_notifications(p_studio uuid) returns setof public.demi_payment_requests language plpgsql security invoker set search_path='' as $$
declare r public.demi_payment_requests%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 for r in select * from public.demi_payment_requests where studio_id=p_studio and notification_status='claimed' and notification_claimed_at<clock_timestamp()-interval '5 minutes' for update skip locked loop
  update public.demi_payment_requests set notification_status='review',notification_error='delivery_outcome_unknown',notification_lease=null where id=r.id;
  perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'technical_block','Confirmación del pago con resultado de entrega desconocido. No se reintentó a ciegas. Solicitud: '||r.id);
 end loop;
 return query update public.demi_payment_requests set notification_status='claimed',notification_lease=gen_random_uuid(),notification_claimed_at=clock_timestamp(),notification_attempts=notification_attempts+1 where id in(select id from public.demi_payment_requests where studio_id=p_studio and status='approved' and notification_status='pending' and notification_attempts<3 order by verified_at for update skip locked limit 25) returning *;
end; $$;
revoke all on function public.service_claim_demi_payment_notifications(uuid) from public,anon,authenticated;
grant execute on function public.service_claim_demi_payment_notifications(uuid) to service_role;

create function public.service_finish_demi_payment_notification(p_request uuid,p_lease uuid,p_accepted boolean,p_provider text,p_error text,p_text text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.demi_payment_requests%rowtype; result text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into r from public.demi_payment_requests where id=p_request and notification_status='claimed' and notification_lease=p_lease for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','notification_lease_lost'); end if;
 if p_accepted and nullif(p_provider,'') is null then raise exception 'provider_confirmation_required'; end if;
 result:=case when p_accepted then 'sent' when r.notification_attempts>=3 or p_error not in ('meta_429','meta_425','demi_uat_injected_delivery_failure') then 'review' else 'pending' end;
 update public.demi_payment_requests set notification_status=result,notification_lease=null,notification_error=p_error,notification_provider_id=p_provider where id=r.id;
 if p_accepted then
  insert into public.assistant_turns(studio_id,conversation_id,direction,role,content,channel_message_ref) values(r.studio_id,r.conversation_id,'outbound','assistant',p_text,p_provider);
 elsif result='review' then
  perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'technical_block','No se entregó la confirmación automática de pago. Solicitud: '||r.id||'; resultado: '||coalesce(p_error,'unknown'));
 end if;
 return jsonb_build_object('ok',true,'status',result);
end; $$;
revoke all on function public.service_finish_demi_payment_notification(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.service_finish_demi_payment_notification(uuid,uuid,boolean,text,text,text) to service_role;

-- Durable retry/reconciliation; no campaign and no execution for synthetic studios.
select cron.schedule('studio_flow_demi_payments','*/5 * * * *',$cron$
 select net.http_post(
  url:=rtrim((select decrypted_secret from vault.decrypted_secrets where name='studio_flow_project_url' limit 1),'/')||'/functions/v1/demi-payment-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-studio-flow-dispatch-token',(select decrypted_secret from vault.decrypted_secrets where name='studio_flow_automation_dispatch_token' limit 1)),
  body:=jsonb_build_object('studio_id',s.studio_id),timeout_milliseconds:=30000
 ) from public.demi_mercadopago_settings s where s.enabled
 and not exists(select 1 from public.demi_uat_runs r where r.studio_id=s.studio_id);
$cron$);
