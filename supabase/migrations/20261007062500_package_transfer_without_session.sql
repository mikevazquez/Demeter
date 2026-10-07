alter table public.assistant_transfer_purchase_intents
  alter column session_id drop not null;

create or replace function public.service_prepare_transfer_purchase(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_product_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_has_activity_scope boolean := false;
  v_activity_match boolean := false;
  v_has_schedule_scope boolean := false;
  v_schedule_match boolean := false;
  v_discipline_match boolean := false;
  v_intent_id uuid;
begin
  if target_studio_id is null
     or target_conversation_id is null
     or target_student_id is null
     or target_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id
    and studio_id=target_studio_id
    and active=true
    and lifecycle_status='active';

  if not found then
    return jsonb_build_object('ok',false,'reason_code','student_not_operable');
  end if;

  if not exists(
    select 1
    from public.assistant_conversations c
    where c.id=target_conversation_id
      and c.studio_id=target_studio_id
      and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  if target_session_id is not null then
    select * into v_session
    from public.class_sessions
    where id=target_session_id
      and studio_id=target_studio_id
      and status='scheduled';

    if not found then
      return jsonb_build_object('ok',false,'reason_code','session_not_available');
    end if;

    select * into v_template
    from public.class_templates
    where id=v_session.template_id
      and studio_id=target_studio_id;

    if not found or v_template.discipline_id is null then
      return jsonb_build_object('ok',false,'reason_code','session_scope_unavailable');
    end if;
  end if;

  select * into v_product
  from public.product_templates
  where id=target_product_template_id
    and studio_id=target_studio_id
    and active=true
    and assistant_visible is distinct from false
    and reward_credit_wallet is distinct from true
    and product_type <> 'enrollment';

  if not found then
    return jsonb_build_object('ok',false,'reason_code','product_not_available');
  end if;

  if target_session_id is not null then
    select exists(
      select 1 from public.product_template_activities pta
      where pta.studio_id=target_studio_id
        and pta.product_template_id=v_product.id
    ) into v_has_activity_scope;

    select exists(
      select 1 from public.product_template_activities pta
      where pta.studio_id=target_studio_id
        and pta.product_template_id=v_product.id
        and pta.class_template_id=v_template.id
    ) into v_activity_match;

    select exists(
      select 1 from public.product_template_disciplines ptd
      where ptd.studio_id=target_studio_id
        and ptd.product_template_id=v_product.id
        and ptd.discipline_id=v_template.discipline_id
    ) into v_discipline_match;

    if not (v_activity_match or (not v_has_activity_scope and v_discipline_match)) then
      return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
    end if;

    select exists(
      select 1 from public.product_template_schedules pts
      where pts.studio_id=target_studio_id
        and pts.product_template_id=v_product.id
    ) into v_has_schedule_scope;

    select exists(
      select 1 from public.product_template_schedules pts
      where pts.studio_id=target_studio_id
        and pts.product_template_id=v_product.id
        and v_session.recurring_schedule_id is not null
        and pts.recurring_schedule_id=v_session.recurring_schedule_id
    ) into v_schedule_match;

    if v_has_schedule_scope and not v_schedule_match then
      return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
    end if;
  end if;

  if not exists(
    select 1
    from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id
      and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id
    and enabled=true;

  if not found
     or nullif(trim(coalesce(v_bank.bank_name,'')),'') is null
     or nullif(trim(coalesce(v_bank.account_holder,'')),'') is null
     or (
       nullif(trim(coalesce(v_bank.clabe,'')),'') is null
       and nullif(trim(coalesce(v_bank.account_number,'')),'') is null
       and nullif(trim(coalesce(v_bank.card_number,'')),'') is null
     ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_details_not_configured');
  end if;

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=target_studio_id
    and conversation_id=target_conversation_id
    and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,v_product.price_minor,v_product.currency,'awaiting_receipt'
  )
  returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,
    'status','awaiting_receipt',
    'intent_id',v_intent_id,
    'package',jsonb_build_object(
      'id',v_product.id,
      'name',v_product.name,
      'amount_minor',v_product.price_minor,
      'currency',v_product.currency
    ),
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,
      'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,
      'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,
      'instructions',v_bank.instructions
    ),
    'receipt_required',true,
    'activation_rule','activate_on_matching_receipt_pending_validation',
    'revocable_until_validated',true
  );
end;
$function$;
