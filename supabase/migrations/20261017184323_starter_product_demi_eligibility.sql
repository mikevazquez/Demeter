-- Demi applies the same purchase eligibility rules as Studio Flow.
CREATE OR REPLACE FUNCTION public.service_product_purchase_eligibility(p_studio_id uuid, p_student_id uuid, p_product_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  if not exists (
    select 1 from public.students
    where id=p_student_id and studio_id=p_studio_id
      and active and lifecycle_status='active'
  ) then
    return jsonb_build_object('eligible',false,'reason_code','student_not_operable');
  end if;
  return private.product_purchase_eligibility(p_studio_id,p_student_id,p_product_template_id);
end;
$function$
;
revoke all on function public.service_product_purchase_eligibility(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_product_purchase_eligibility(uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.service_create_demi_cash_purchase(p_studio uuid, p_conversation uuid, p_student uuid, p_product uuid, p_key uuid, p_expected_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  st public.students%rowtype;
  pt public.product_templates%rowtype;
  old public.demi_cash_purchases%rowtype;
  sale uuid:=gen_random_uuid();
  line uuid;
  acquisition uuid;
  today date;
  eligibility jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;

  select * into st
  from public.students
  where id=p_student and studio_id=p_studio and active and lifecycle_status='active'
  for update;

  if not found or st.student_type<>'regular' then
    return jsonb_build_object('ok',false,'reason_code','cash_students_only');
  end if;

  if not exists(
    select 1 from public.assistant_conversations
    where id=p_conversation and studio_id=p_studio and student_id=st.id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select * into old
  from public.demi_cash_purchases
  where id=p_key and studio_id=p_studio and conversation_id=p_conversation and student_id=p_student;

  if found then
    return jsonb_build_object(
      'ok',true,'idempotent',true,'sale_id',old.sale_id,
      'acquisition_id',old.acquisition_id,'payment_received',false
    );
  end if;

  select * into pt
  from public.product_templates
  where id=p_product and studio_id=p_studio and active and assistant_visible
    and product_type in ('package','membership');

  if not found or pt.price_minor<=0 then
    return jsonb_build_object('ok',false,'reason_code','cash_package_not_available');
  end if;

  eligibility := private.product_purchase_eligibility(p_studio,p_student,p_product);
  if coalesce((eligibility->>'eligible')::boolean,false) is not true then
    return jsonb_build_object(
      'ok',false,
      'reason_code',coalesce(eligibility->>'reason_code','product_not_eligible')
    );
  end if;

  if pt.enrollment_included then
    return jsonb_build_object('ok',false,'reason_code','included_enrollment_requires_online_or_staff_checkout');
  end if;

  if pt.price_minor is distinct from p_expected_amount then
    return jsonb_build_object('ok',false,'reason_code','purchase_price_changed');
  end if;

  if not exists(
    select 1 from public.studio_payment_methods
    where studio_id=p_studio and code='cash' and active
  ) then
    return jsonb_build_object('ok',false,'reason_code','cash_payment_disabled');
  end if;

  if exists(
    select 1
    from public.demi_cash_purchases c
    join public.sales s on s.id=c.sale_id and s.studio_id=c.studio_id
    where c.studio_id=p_studio and c.student_id=p_student and s.status='confirmed'
      and s.total_minor>(
        select coalesce(sum(case when kind='payment' then amount_minor else -amount_minor end),0)
        from public.payments where sale_id=s.id and studio_id=p_studio
      )
  ) then
    return jsonb_build_object('ok',false,'reason_code','cash_purchase_already_pending');
  end if;

  select (clock_timestamp() at time zone timezone)::date
  into today
  from public.studios
  where id=p_studio;

  insert into public.sales(
    id,studio_id,student_id,folio,status,currency,total_minor,idempotency_key,
    payment_due_on,collection_note,pending_access_exception,pending_access_exception_reason
  ) values(
    sale,p_studio,p_student,'V-CASH-'||upper(replace(sale::text,'-','')),
    'confirmed',pt.currency,pt.price_minor,p_key,today,
    'Efectivo declarado: pendiente de cobro. Una primera reserva permitida.',
    true,'Demi: efectivo declarado, acceso limitado a una primera reserva'
  );

  insert into public.sale_lines(
    studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
  ) values(p_studio,sale,pt.id,pt.name,1,pt.price_minor,pt.price_minor)
  returning id into line;

  insert into public.product_acquisitions(
    studio_id,student_id,product_template_id,status,starts_on,expires_on,
    activation_mode,credit_limit,unlimited,sale_line_id,validity_days_snapshot
  ) values(
    p_studio,p_student,pt.id,'active',null,null,'first_usage',
    pt.credit_limit,pt.unlimited,line,pt.validity_days
  ) returning id into acquisition;

  if not pt.unlimited then
    insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note)
    values(p_studio,acquisition,'grant',pt.credit_limit,'Paquete pendiente de efectivo; no acredita pago recibido');
  end if;

  insert into public.demi_cash_purchases(
    id,studio_id,conversation_id,student_id,product_template_id,sale_id,acquisition_id
  ) values(p_key,p_studio,p_conversation,p_student,pt.id,sale,acquisition);

  return jsonb_build_object(
    'ok',true,'status','cash_due','sale_id',sale,'acquisition_id',acquisition,
    'amount_minor',pt.price_minor,'currency',pt.currency,'payment_received',false,
    'first_reservation_allowed',true,'starts_with_first_reservation',true
  );
end;
$function$
;
revoke all on function public.service_create_demi_cash_purchase(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.service_create_demi_cash_purchase(uuid,uuid,uuid,uuid,uuid,integer) to service_role;

CREATE OR REPLACE FUNCTION public.service_prepare_transfer_purchase(target_studio_id uuid, target_conversation_id uuid, target_student_id uuid, target_session_id uuid, target_product_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_eligibility jsonb;
begin
  if target_studio_id is null or target_conversation_id is null
     or target_student_id is null or target_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id and studio_id=target_studio_id
    and active=true and lifecycle_status='active'
  for update;

  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;

  if not exists(
    select 1 from public.assistant_conversations c
    where c.id=target_conversation_id and c.studio_id=target_studio_id
      and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  if target_session_id is not null then
    select * into v_session
    from public.class_sessions
    where id=target_session_id and studio_id=target_studio_id and status='scheduled';
    if not found then return jsonb_build_object('ok',false,'reason_code','session_not_available'); end if;

    select * into v_template
    from public.class_templates
    where id=v_session.template_id and studio_id=target_studio_id;
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

  if not found then return jsonb_build_object('ok',false,'reason_code','product_not_available'); end if;

  v_eligibility := private.product_purchase_eligibility(
    target_studio_id,target_student_id,v_product.id
  );
  if coalesce((v_eligibility->>'eligible')::boolean,false) is not true then
    return jsonb_build_object(
      'ok',false,
      'reason_code',coalesce(v_eligibility->>'reason_code','product_not_eligible')
    );
  end if;

  if v_product.enrollment_included then
    return jsonb_build_object('ok',false,'reason_code','included_enrollment_requires_online_or_staff_checkout');
  end if;

  if target_session_id is not null then
    select exists(
      select 1 from public.product_template_activities pta
      where pta.studio_id=target_studio_id and pta.product_template_id=v_product.id
    ) into v_has_activity_scope;
    select exists(
      select 1 from public.product_template_activities pta
      where pta.studio_id=target_studio_id and pta.product_template_id=v_product.id
        and pta.class_template_id=v_template.id
    ) into v_activity_match;
    select exists(
      select 1 from public.product_template_disciplines ptd
      where ptd.studio_id=target_studio_id and ptd.product_template_id=v_product.id
        and ptd.discipline_id=v_template.discipline_id
    ) into v_discipline_match;
    if not (v_activity_match or (not v_has_activity_scope and v_discipline_match)) then
      return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
    end if;

    select exists(
      select 1 from public.product_template_schedules pts
      where pts.studio_id=target_studio_id and pts.product_template_id=v_product.id
    ) into v_has_schedule_scope;
    select exists(
      select 1 from public.product_template_schedules pts
      where pts.studio_id=target_studio_id and pts.product_template_id=v_product.id
        and v_session.recurring_schedule_id is not null
        and pts.recurring_schedule_id=v_session.recurring_schedule_id
    ) into v_schedule_match;
    if v_has_schedule_scope and not v_schedule_match then
      return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
    end if;
  end if;

  if not exists(
    select 1 from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id and enabled=true;

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
  where studio_id=target_studio_id and conversation_id=target_conversation_id
    and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status
  ) values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,v_product.price_minor,v_product.currency,'awaiting_receipt'
  ) returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,'status','awaiting_receipt','intent_id',v_intent_id,
    'package',jsonb_build_object(
      'id',v_product.id,'name',v_product.name,
      'amount_minor',v_product.price_minor,'currency',v_product.currency
    ),
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,'instructions',v_bank.instructions
    ),
    'receipt_required',true,
    'activation_rule','activate_on_matching_receipt_pending_validation',
    'revocable_until_validated',true
  );
end;
$function$
;
revoke all on function public.service_prepare_transfer_purchase(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_prepare_transfer_purchase(uuid,uuid,uuid,uuid,uuid) to service_role;
