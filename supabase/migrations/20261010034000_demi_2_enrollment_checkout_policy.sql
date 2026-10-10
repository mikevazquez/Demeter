-- Required enrollment uses the active enrollment-policy product, like the existing enrollment-only checkout. Catalog flags do not disable this owned mandatory payment.
create or replace function public.service_prepare_demi_enrollment_payment(p_studio uuid,p_conversation uuid,p_student uuid,p_method text)
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
 select * into product from public.product_templates where id=policy.enrollment_product_template_id and studio_id=p_studio and active and product_type='enrollment' and price_minor>0;
 if not found then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
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
