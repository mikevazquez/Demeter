create or replace function public.assistant_create_post_trial_reservation(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_method text := lower(trim(coalesce(target_payment_method,'')));
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_occupied integer := 0;
  v_reservation_id uuid;
  v_intent_id uuid;
  v_existing public.assistant_enrollment_intents%rowtype;
  v_tz text;
  v_today date;
begin
  if v_method not in ('cash','bank_transfer') then return jsonb_build_object('ok',false,'reason_code','payment_method_not_supported'); end if;
  if coalesce((select auth.role()),'')<>'service_role' and not private.has_capability(target_studio_id,'schedule.write') then raise exception 'forbidden'; end if;

  select * into v_student from public.students s where s.id=target_student_id and s.studio_id=target_studio_id for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;

  select count(*)::integer into v_attended from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='attended';
  if v_attended<1 then return jsonb_build_object('ok',false,'reason_code','post_trial_not_reached'); end if;

  select coalesce(s.timezone,'America/Mexico_City') into v_tz from public.studios s where s.id=target_studio_id;
  v_today:=(clock_timestamp() at time zone v_tz)::date;
  if private.student_has_active_enrollment(target_studio_id,target_student_id,v_today) then return jsonb_build_object('ok',false,'reason_code','enrollment_already_active'); end if;

  select * into v_policy from public.enrollment_policies ep where ep.studio_id=target_studio_id;
  if not found or not v_policy.enabled or v_policy.enrollment_product_template_id is null then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;

  select * into v_product from public.product_templates pt
  where pt.id=v_policy.enrollment_product_template_id and pt.studio_id=target_studio_id and pt.active=true and pt.product_type='enrollment'::public.product_type;
  if not found then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;

  select * into v_session from public.class_sessions cs
  where cs.id=target_session_id and cs.studio_id=target_studio_id for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
  if coalesce(v_session.requires_resource,false) then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;

  select * into v_template from public.class_templates ct where ct.id=v_session.template_id and ct.studio_id=target_studio_id;
  select count(*)::integer into v_occupied from public.reservations r where r.session_id=target_session_id and r.status in ('reserved','attended');
  if v_occupied>=v_session.capacity then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
  if exists(select 1 from public.reservations r where r.studio_id=target_studio_id and r.session_id=target_session_id and r.student_id=target_student_id and r.status in ('reserved','attended')) then return jsonb_build_object('ok',false,'reason_code','already_reserved'); end if;

  select aei.* into v_existing from public.assistant_enrollment_intents aei
  where aei.studio_id=target_studio_id and aei.student_id=target_student_id and aei.target_session_id=target_session_id
    and aei.status in ('cash_due','receipt_required','human_review','online_pending')
  order by aei.created_at desc limit 1;
  if found then
    return jsonb_build_object('ok',true,'reused',true,'intent_id',v_existing.id,'reservation_id',v_existing.reservation_id,
      'payment_method',v_existing.payment_method,'status',v_existing.status,'enrollment_amount_minor',v_existing.amount_minor,'currency',v_existing.currency);
  end if;

  insert into public.reservations(studio_id,session_id,student_id,student_user_id,acquisition_id,status,credits_held,commercial_status)
  values(target_studio_id,target_session_id,target_student_id,v_student.user_id,null,'reserved',greatest(coalesce(v_template.credit_cost,1),1),'payment_pending')
  returning id into v_reservation_id;

  insert into public.assistant_reservation_links(studio_id,reservation_id,assistant_conversation_id,source)
  values(target_studio_id,v_reservation_id,target_conversation_id,'assistant_post_trial')
  on conflict(studio_id,reservation_id) do nothing;

  insert into public.assistant_enrollment_intents(studio_id,conversation_id,student_id,enrollment_product_template_id,target_session_id,reservation_id,payment_method,status,amount_minor,currency)
  values(target_studio_id,target_conversation_id,target_student_id,v_product.id,target_session_id,v_reservation_id,v_method,
    case when v_method='cash' then 'cash_due' else 'receipt_required' end,v_product.price_minor,upper(v_product.currency))
  returning id into v_intent_id;

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,p_event_type=>'booking.created',p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,p_deduplication_key=>'booking.created:assistant-post-trial:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),p_payload=>jsonb_build_object('reservation_id',v_reservation_id,'session_id',target_session_id,
      'student_id',target_student_id,'source','assistant_post_trial','commercial_status','payment_pending','enrollment_payment_method',v_method));

  return jsonb_build_object('ok',true,'reused',false,'intent_id',v_intent_id,'reservation_id',v_reservation_id,'payment_method',v_method,
    'status',case when v_method='cash' then 'cash_due' else 'receipt_required' end,'enrollment_amount_minor',v_product.price_minor,
    'currency',upper(v_product.currency),'class_amount_minor',v_template.drop_in_price_minor,'review_required',v_method='bank_transfer');
end;
$function$;
