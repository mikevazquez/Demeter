-- Paid trial credits cannot fall back to the unpaid first-trial exception.
alter function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) rename to assistant_trial_booking_preview_demi2_base;
alter function public.assistant_trial_booking_preview_demi2_base(uuid,uuid,uuid,uuid) set schema private;
revoke all on function private.assistant_trial_booking_preview_demi2_base(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.assistant_trial_booking_preview(target_studio_id uuid,target_session_id uuid,target_student_id uuid default null,target_crm_contact_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; student uuid; payment_activation boolean; credit jsonb;
begin
 r:=private.assistant_trial_booking_preview_demi2_base(target_studio_id,target_session_id,target_student_id,target_crm_contact_id);
 student:=coalesce(target_student_id,(select converted_student_id from public.crm_contacts where id=target_crm_contact_id and studio_id=target_studio_id));
 payment_activation:=auth.role()='service_role' and exists(select 1 from public.assistant_transfer_purchase_intents i where i.id::text=current_setting('demi.trial_payment_activation',true) and i.studio_id=target_studio_id and i.student_id=student and i.session_id=target_session_id and i.intent_kind='trial_class' and i.status='awaiting_receipt' and i.expires_at>clock_timestamp());
 if payment_activation and r->>'reason_code'='trial_prepayment_required' then
  r:=r||jsonb_build_object('ok',true,'eligible',true,'trial_exception',true,'reason_code',null);
 end if;
 if not coalesce((r->>'eligible')::boolean,false) then return r; end if;
 if student is not null and not payment_activation and exists(select 1 from public.assistant_transfer_purchase_intents i where i.studio_id=target_studio_id and i.student_id=student and i.intent_kind='trial_class' and i.acquisition_id is not null) then
  credit:=public.service_booking_eligibility(target_studio_id,target_session_id,student);
  if coalesce((credit->>'eligible')::boolean,false) then
   return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_requires_standard_booking');
  end if;
  return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_payment_required','prepayment_required',true,'amount_minor',15000,'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN')));
 end if;
 return r;
end; $$;
revoke all on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid) to authenticated,service_role;

-- Only the receipt/payment activation functions open a scoped booking exception.
-- Their existing ownership, amount, provider and replay checks run before booking.
alter function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) rename to service_activate_trial_transfer_receipt_demi2_base;
alter function public.service_activate_trial_transfer_receipt_demi2_base(uuid,uuid,uuid,uuid,uuid,text,text) set schema private;
revoke all on function private.service_activate_trial_transfer_receipt_demi2_base(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.service_activate_trial_transfer_receipt(target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_intent_id uuid,target_event_id uuid,target_provider_message_id text,target_media_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; previous text:=current_setting('demi.trial_payment_activation',true);
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 perform set_config('demi.trial_payment_activation',target_intent_id::text,true);
 r:=private.service_activate_trial_transfer_receipt_demi2_base(target_studio_id,target_conversation_id,target_student_id,target_intent_id,target_event_id,target_provider_message_id,target_media_id);
 perform set_config('demi.trial_payment_activation',coalesce(previous,''),true);
 return r;
end; $$;
revoke all on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

alter function public.service_activate_demi_paid_trial(uuid,uuid,uuid,uuid,uuid,integer) rename to service_activate_demi_paid_trial_demi2_base;
alter function public.service_activate_demi_paid_trial_demi2_base(uuid,uuid,uuid,uuid,uuid,integer) set schema private;
revoke all on function private.service_activate_demi_paid_trial_demi2_base(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.service_activate_demi_paid_trial(target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_intent_id uuid,target_request_id uuid,target_ordinal integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; previous text:=current_setting('demi.trial_payment_activation',true);
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 perform set_config('demi.trial_payment_activation',target_intent_id::text,true);
 r:=private.service_activate_demi_paid_trial_demi2_base(target_studio_id,target_conversation_id,target_student_id,target_intent_id,target_request_id,target_ordinal);
 perform set_config('demi.trial_payment_activation',coalesce(previous,''),true);
 return r;
end; $$;
revoke all on function public.service_activate_demi_paid_trial(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.service_activate_demi_paid_trial(uuid,uuid,uuid,uuid,uuid,integer) to service_role;
