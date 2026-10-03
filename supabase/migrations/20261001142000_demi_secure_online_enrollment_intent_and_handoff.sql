create or replace function public.assistant_create_online_enrollment_intent(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_existing public.assistant_enrollment_intents%rowtype;
  v_id uuid;
begin
  if coalesce((select auth.role()),'')<>'service_role' and not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  select * into v_policy from public.enrollment_policies ep where ep.studio_id=target_studio_id;
  if not found or not v_policy.enabled or v_policy.enrollment_product_template_id is null then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
  select * into v_product from public.product_templates pt where pt.id=v_policy.enrollment_product_template_id and pt.studio_id=target_studio_id and pt.active=true and pt.product_type='enrollment'::public.product_type;
  if not found then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
  select aei.* into v_existing from public.assistant_enrollment_intents aei
  where aei.studio_id=target_studio_id and aei.conversation_id=target_conversation_id and aei.student_id=target_student_id
    and aei.payment_method='app' and aei.status='online_pending'
  order by aei.created_at desc limit 1;
  if found then return jsonb_build_object('ok',true,'reused',true,'intent_id',v_existing.id,'amount_minor',v_existing.amount_minor,'currency',v_existing.currency); end if;
  insert into public.assistant_enrollment_intents(studio_id,conversation_id,student_id,enrollment_product_template_id,target_session_id,reservation_id,payment_method,status,amount_minor,currency)
  values(target_studio_id,target_conversation_id,target_student_id,v_product.id,target_session_id,null,'app','online_pending',v_product.price_minor,upper(v_product.currency))
  returning id into v_id;
  return jsonb_build_object('ok',true,'reused',false,'intent_id',v_id,'amount_minor',v_product.price_minor,'currency',upper(v_product.currency));
end;
$function$;

create or replace function public.assistant_create_handoff(
  target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_reason_code text,target_note text default null
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
  if coalesce((select auth.role()),'')<>'service_role' and not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  select ah.id into v_id from public.assistant_handoffs ah
  where ah.studio_id=target_studio_id and ah.conversation_id=target_conversation_id and ah.status='open'
  order by ah.created_at desc limit 1;
  if v_id is null then
    insert into public.assistant_handoffs(studio_id,conversation_id,student_id,reason_code,note,status)
    values(target_studio_id,target_conversation_id,target_student_id,left(coalesce(nullif(trim(target_reason_code),''),'human_review'),120),
      nullif(left(trim(coalesce(target_note,'')),1000),''),'open') returning id into v_id;
  end if;
  if target_reason_code='transfer_receipt_review' then
    update public.assistant_enrollment_intents aei set status='human_review',updated_at=now()
    where aei.id=(select aei2.id from public.assistant_enrollment_intents aei2
      where aei2.studio_id=target_studio_id and aei2.conversation_id=target_conversation_id and aei2.status='receipt_required'
      order by aei2.created_at desc limit 1);
  end if;
  return jsonb_build_object('ok',true,'handoff_id',v_id,'status','open');
end;
$function$;

revoke all on function public.assistant_create_online_enrollment_intent(uuid,uuid,uuid,uuid) from public;
grant execute on function public.assistant_create_online_enrollment_intent(uuid,uuid,uuid,uuid) to authenticated,service_role;
