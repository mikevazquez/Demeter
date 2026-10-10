-- Keep the existing authenticated booking path and require a new payment after an exhausted trial.
create or replace function public.assistant_trial_booking_preview(target_studio_id uuid,target_session_id uuid,target_student_id uuid default null,target_crm_contact_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; student uuid; payment_activation boolean; credit jsonb;
begin
 r:=private.assistant_trial_booking_preview_demi2_base(target_studio_id,target_session_id,target_student_id,target_crm_contact_id);
 student:=coalesce(target_student_id,(select converted_student_id from public.crm_contacts where id=target_crm_contact_id and studio_id=target_studio_id));
 payment_activation:=auth.role()='service_role' and exists(select 1 from public.assistant_transfer_purchase_intents i where i.id::text=current_setting('demi.trial_payment_activation',true) and i.studio_id=target_studio_id and i.student_id=student and i.session_id=target_session_id and i.intent_kind='trial_class' and i.status='awaiting_receipt' and i.expires_at>clock_timestamp());
 if payment_activation and r->>'reason_code'='trial_prepayment_required' then
  r:=r||jsonb_build_object('ok',true,'eligible',true,'trial_exception',true,'reason_code',null);
 end if;
 if not coalesce((r->>'eligible')::boolean,false) and r->>'reason_code' is distinct from 'trial_prepayment_required' then return r; end if;
 if student is not null and not payment_activation and exists(select 1 from public.assistant_transfer_purchase_intents i where i.studio_id=target_studio_id and i.student_id=student and i.intent_kind='trial_class' and i.acquisition_id is not null) then
  credit:=private.booking_eligibility_core(target_session_id,student,false);
  if coalesce((credit->>'eligible')::boolean,false) then
   return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_requires_standard_booking');
  end if;
  return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_payment_required','prepayment_required',true,'amount_minor',15000,'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN')));
 end if;
 return r;
end; $$;
