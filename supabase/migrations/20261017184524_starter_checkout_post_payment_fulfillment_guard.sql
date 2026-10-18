-- Do not re-run product eligibility after the payment provider has accredited funds.
-- Eligibility is enforced when creating the checkout attempt; fulfillment stays idempotent.
CREATE OR REPLACE FUNCTION public.service_confirm_online_checkout_approved(target_attempt_id uuid, target_provider_order_id text, target_provider_payment_id text, target_external_reference text, target_provider_status text, target_provider_status_detail text, target_paid_amount_minor integer, target_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attempt public.online_checkout_attempts%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_enrollment_sale_line_id uuid;
  v_acquisition_id uuid;
  v_enrollment_id uuid;
  v_sale_date date;
  v_timezone text;
  v_folio text;
  v_extra jsonb;
  v_extra_price integer := 0;
  v_extra_regular_price integer := 0;
  v_main_amount integer;
  v_main_product_type text;
  v_enrollment_product_id uuid;
  v_enrollment_name text;
  v_enrollment_validity_days integer;
  v_enrollment_resolution text := 'paid';
  v_enrollment_reason text;
  v_eligibility jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  if target_attempt_id is null then raise exception 'attempt_required'; end if;
  if nullif(trim(coalesce(target_provider_order_id, '')), '') is null then raise exception 'provider_order_required'; end if;
  if nullif(trim(coalesce(target_provider_payment_id, '')), '') is null then raise exception 'provider_payment_required'; end if;
  if nullif(trim(coalesce(target_external_reference, '')), '') is null then raise exception 'external_reference_required'; end if;
  if coalesce(target_paid_amount_minor, 0) <= 0 then raise exception 'paid_amount_invalid'; end if;

  select * into v_attempt
  from public.online_checkout_attempts
  where id = target_attempt_id
    and provider = 'mercado_pago'
  for update;

  if not found then raise exception 'checkout_attempt_not_found'; end if;

  if v_attempt.processed_at is not null or v_attempt.sale_id is not null then
    if v_attempt.provider_order_id is distinct from target_provider_order_id then raise exception 'provider_order_mismatch'; end if;
    if v_attempt.provider_payment_id is not null
       and v_attempt.provider_payment_id is distinct from target_provider_payment_id then raise exception 'provider_payment_mismatch'; end if;
    return jsonb_build_object('ok',true,'reused',true,'attempt_id',v_attempt.id,'sale_id',v_attempt.sale_id,'provider_payment_id',v_attempt.provider_payment_id);
  end if;

  if v_attempt.provider_order_id is distinct from target_provider_order_id then raise exception 'provider_order_mismatch'; end if;
  if v_attempt.external_reference is distinct from target_external_reference then raise exception 'external_reference_mismatch'; end if;
  if lower(coalesce(target_provider_status, '')) <> 'processed'
     or lower(coalesce(target_provider_status_detail, '')) <> 'accredited' then raise exception 'provider_not_approved'; end if;
  if v_attempt.amount_minor <> target_paid_amount_minor then raise exception 'paid_amount_mismatch'; end if;
  if upper(v_attempt.currency) <> upper(coalesce(target_currency, '')) then raise exception 'currency_mismatch'; end if;
  if v_attempt.validity_days_snapshot is null or v_attempt.validity_days_snapshot <= 0 then raise exception 'product_validity_missing'; end if;

  select pt.product_type::text into v_main_product_type
  from public.product_templates pt
  where pt.id=v_attempt.product_template_id
    and pt.studio_id=v_attempt.studio_id;

  if v_main_product_type is null then raise exception 'product_not_available_online'; end if;

  -- Eligibility is enforced before the provider order is created. Once payment is accredited,
  -- fulfillment must be idempotent and must not strand a paid customer.

  v_extra := v_attempt.extra_fulfillment_snapshot;
  if v_extra is not null then
    if v_extra->>'type' <> 'enrollment' then raise exception 'extra_fulfillment_invalid'; end if;
    v_extra_price := coalesce((v_extra->>'price_minor')::integer,0);
    v_extra_regular_price := coalesce((v_extra->>'regular_price_minor')::integer,v_extra_price);
    v_enrollment_product_id := (v_extra->>'product_template_id')::uuid;
    v_enrollment_name := nullif(v_extra->>'name','');
    v_enrollment_validity_days := nullif(v_extra->>'validity_days','')::integer;
    v_enrollment_resolution := coalesce(nullif(v_extra->>'resolution',''),'paid');
    v_enrollment_reason := nullif(v_extra->>'resolution_reason','');

    if v_enrollment_product_id is null or v_enrollment_name is null or v_extra_regular_price<=0 then
      raise exception 'extra_fulfillment_invalid';
    end if;
    if v_enrollment_resolution not in ('paid','promotion') then raise exception 'extra_fulfillment_invalid'; end if;
    if v_enrollment_resolution='paid' and v_extra_price<=0 then raise exception 'extra_fulfillment_invalid'; end if;
    if v_enrollment_resolution='promotion' and (v_extra_price<>0 or v_enrollment_reason is null) then raise exception 'extra_fulfillment_invalid'; end if;
  end if;

  v_main_amount := v_attempt.amount_minor - v_extra_price;
  if v_main_amount<=0 then raise exception 'checkout_amount_invalid'; end if;

  select timezone into v_timezone from public.studios where id = v_attempt.studio_id;
  v_sale_date := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;
  v_folio := 'MP-' || to_char(v_sale_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_attempt.id::text, '-', ''), 1, 12));

  insert into public.sales(id,studio_id,student_id,folio,currency,total_minor,created_by)
  values(v_sale_id,v_attempt.studio_id,v_attempt.student_id,v_folio,v_attempt.currency,v_attempt.amount_minor,null);

  insert into public.sale_lines(studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor)
  values(v_attempt.studio_id,v_sale_id,v_attempt.product_template_id,v_attempt.product_name_snapshot,1,v_main_amount,v_main_amount)
  returning id into v_sale_line_id;

  if v_main_product_type='enrollment' then
    insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on,source_sale_id,source_sale_line_id,created_by)
    values(v_attempt.studio_id,v_attempt.student_id,'active',v_sale_date,v_sale_date + v_attempt.validity_days_snapshot,v_sale_id,v_sale_line_id,null)
    returning id into v_enrollment_id;
  else
    insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited,sale_line_id,activation_mode,validity_days_snapshot)
    values(v_attempt.studio_id,v_attempt.student_id,v_attempt.product_template_id,'active',v_sale_date,v_sale_date + v_attempt.validity_days_snapshot,v_attempt.credit_limit_snapshot,v_attempt.unlimited_snapshot,v_sale_line_id,'fixed_date',v_attempt.validity_days_snapshot)
    returning id into v_acquisition_id;

    if not v_attempt.unlimited_snapshot and coalesce(v_attempt.credit_limit_snapshot, 0) > 0 then
      insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by)
      values(v_attempt.studio_id,v_acquisition_id,'grant',v_attempt.credit_limit_snapshot,'Venta Mercado Pago ' || v_folio,null);
    end if;
  end if;

  if v_extra is not null then
    insert into public.sale_lines(
      studio_id,sale_id,product_template_id,product_name,quantity,
      unit_price_minor,discount_minor,discount_kind,discount_input,
      discount_reason,line_total_minor
    ) values (
      v_attempt.studio_id,v_sale_id,v_enrollment_product_id,v_enrollment_name,1,
      v_extra_regular_price,
      case when v_enrollment_resolution='promotion' then v_extra_regular_price else 0 end,
      case when v_enrollment_resolution='promotion' then 'promotion' else null end,
      case when v_enrollment_resolution='promotion' then '100%' else null end,
      case when v_enrollment_resolution='promotion' then v_enrollment_reason else null end,
      v_extra_price
    ) returning id into v_enrollment_sale_line_id;

    insert into public.student_enrollments(
      studio_id,student_id,status,starts_on,expires_on,source_sale_id,
      source_sale_line_id,created_by,resolution_type,resolution_reason
    ) values (
      v_attempt.studio_id,v_attempt.student_id,'active',v_sale_date,
      case when v_enrollment_validity_days is null then null else v_sale_date + v_enrollment_validity_days end,
      v_sale_id,v_enrollment_sale_line_id,null,v_enrollment_resolution,
      case when v_enrollment_resolution='promotion' then v_enrollment_reason else null end
    ) returning id into v_enrollment_id;
  end if;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
  values(v_attempt.studio_id,v_sale_id,'payment',v_attempt.amount_minor,'mercado_pago',trim(target_provider_payment_id),'Mercado Pago Order ' || trim(target_provider_order_id),null);

  update public.online_checkout_attempts
  set provider_payment_id = trim(target_provider_payment_id),
      status = 'approved',
      provider_status = trim(target_provider_status),
      provider_status_detail = trim(target_provider_status_detail),
      sale_id = v_sale_id,
      approved_at = now(),
      processed_at = now(),
      last_webhook_at = now(),
      failure_code = null,
      updated_at = now()
  where id = v_attempt.id;

  return jsonb_build_object(
    'ok',true,'reused',false,'attempt_id',v_attempt.id,'sale_id',v_sale_id,
    'sale_line_id',v_sale_line_id,'acquisition_id',v_acquisition_id,
    'enrollment_id',v_enrollment_id,'provider_payment_id',trim(target_provider_payment_id)
  );
end;
$function$
;
revoke all on function public.service_confirm_online_checkout_approved(uuid,text,text,text,text,text,integer,text)
from public,anon,authenticated;
grant execute on function public.service_confirm_online_checkout_approved(uuid,text,text,text,text,text,integer,text)
to service_role;
