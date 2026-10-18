-- Starter / introductory product foundation.
alter table public.product_templates
  add column if not exists purchase_eligibility text not null default 'all',
  add column if not exists purchase_limit_per_student integer,
  add column if not exists enrollment_included boolean not null default false;

alter table public.product_templates drop constraint if exists product_templates_purchase_eligibility_check;
alter table public.product_templates add constraint product_templates_purchase_eligibility_check
  check (purchase_eligibility in ('all','new_customer'));
alter table public.product_templates drop constraint if exists product_templates_purchase_limit_check;
alter table public.product_templates add constraint product_templates_purchase_limit_check
  check (purchase_limit_per_student is null or purchase_limit_per_student > 0);

CREATE OR REPLACE FUNCTION private.product_purchase_eligibility(p_studio_id uuid, p_student_id uuid, p_product_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_product public.product_templates%rowtype;
  v_purchase_count integer := 0;
  v_prior_package_count integer := 0;
begin
  select * into v_product
  from public.product_templates
  where id = p_product_template_id
    and studio_id = p_studio_id;

  if not found or not v_product.active then
    return jsonb_build_object('eligible', false, 'reason_code', 'product_not_available');
  end if;

  select count(*)::integer into v_purchase_count
  from public.sale_lines sl
  join public.sales s
    on s.id = sl.sale_id
   and s.studio_id = sl.studio_id
  where s.studio_id = p_studio_id
    and s.student_id = p_student_id
    and s.status = 'confirmed'
    and sl.product_template_id = p_product_template_id;

  if v_product.purchase_limit_per_student is not null
     and v_purchase_count >= v_product.purchase_limit_per_student then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'purchase_limit_reached',
      'purchase_count', v_purchase_count,
      'purchase_limit', v_product.purchase_limit_per_student
    );
  end if;

  if v_product.purchase_eligibility = 'new_customer' then
    select count(*)::integer into v_prior_package_count
    from public.sale_lines sl
    join public.sales s
      on s.id = sl.sale_id
     and s.studio_id = sl.studio_id
    join public.product_templates prior_pt
      on prior_pt.id = sl.product_template_id
     and prior_pt.studio_id = sl.studio_id
    where s.studio_id = p_studio_id
      and s.student_id = p_student_id
      and s.status = 'confirmed'
      and prior_pt.product_type::text in ('package','membership');

    if v_prior_package_count > 0 then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'new_customer_only',
        'prior_package_count', v_prior_package_count
      );
    end if;
  end if;

  return jsonb_build_object(
    'eligible', true,
    'reason_code', null,
    'purchase_count', v_purchase_count,
    'purchase_limit', v_product.purchase_limit_per_student,
    'purchase_eligibility', v_product.purchase_eligibility,
    'enrollment_included', v_product.enrollment_included
  );
end;
$function$
;
revoke all on function private.product_purchase_eligibility(uuid,uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.student_product_purchase_eligibility(target_product_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  return private.product_purchase_eligibility(
    v_student.studio_id,
    v_student.id,
    target_product_template_id
  );
end;
$function$
;
revoke all on function public.student_product_purchase_eligibility(uuid) from public,anon;
grant execute on function public.student_product_purchase_eligibility(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.student_online_product_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.price_minor, q.name), '[]'::jsonb)
  into v_result
  from (
    select
      pt.id, pt.name, pt.product_type::text as product_type, pt.package_term,
      pt.price_minor, pt.currency, pt.validity_days, pt.credit_limit, pt.unlimited,
      pt.purchase_eligibility, pt.purchase_limit_per_student, pt.enrollment_included
    from public.product_templates pt
    where pt.studio_id = v_student.studio_id
      and pt.active
      and pt.online_purchasable
      and pt.product_type::text in ('package','membership')
      and coalesce(
        (private.product_purchase_eligibility(
          v_student.studio_id,
          v_student.id,
          pt.id
        )->>'eligible')::boolean,
        false
      )
  ) q;

  return v_result;
end;
$function$
;
revoke all on function public.student_online_product_options() from public,anon;
grant execute on function public.student_online_product_options() to authenticated;

CREATE OR REPLACE FUNCTION public.student_create_online_checkout_attempt(target_product_template_id uuid, target_client_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_enroll public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid:=gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
  v_policy public.enrollment_policies%rowtype;
  v_extra jsonb:=null;
  v_extra_price int:=0;
  v_extra_regular_price int:=0;
  v_eligibility jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=auth.uid()
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at
  limit 1
  for update;

  if not found then raise exception 'student_context_not_found'; end if;

  select pt.* into v_product
  from public.product_templates pt
  where pt.id=target_product_template_id
    and pt.studio_id=v_student.studio_id
    and pt.active
    and pt.online_purchasable
    and pt.product_type::text in ('package','membership');

  if not found then raise exception 'product_not_available_online'; end if;

  v_eligibility := private.product_purchase_eligibility(
    v_student.studio_id,
    v_student.id,
    v_product.id
  );

  if coalesce((v_eligibility->>'eligible')::boolean,false) is not true then
    raise exception '%', coalesce(v_eligibility->>'reason_code','product_not_eligible');
  end if;

  if exists (
    select 1
    from public.online_checkout_attempts a
    where a.studio_id=v_student.studio_id
      and a.student_id=v_student.id
      and a.product_template_id=v_product.id
      and a.processed_at is null
      and a.status::text in ('created','order_created','pending')
      and a.created_at > clock_timestamp() - interval '60 minutes'
      and a.client_request_key <> target_client_request_key
  ) then
    raise exception 'product_purchase_in_progress';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
  into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today:=(clock_timestamp() at time zone v_timezone)::date;
  v_price:=private.reward_checkout_price(v_student.id,v_product.id,v_today);

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  if found
     and v_policy.enabled
     and v_policy.required_for_package_purchase
     and not private.student_has_active_enrollment(v_student.studio_id,v_student.id,v_today) then

    select * into v_enroll
    from public.product_templates
    where id=v_policy.enrollment_product_template_id
      and studio_id=v_student.studio_id
      and active
      and product_type='enrollment';

    if not found then raise exception 'enrollment_product_not_configured'; end if;

    v_extra_regular_price := v_enroll.price_minor;

    if v_product.enrollment_included then
      v_extra_price := 0;
      v_extra := jsonb_build_object(
        'type','enrollment',
        'product_template_id',v_enroll.id,
        'name',v_enroll.name,
        'price_minor',0,
        'regular_price_minor',v_enroll.price_minor,
        'currency',upper(v_enroll.currency),
        'validity_days',v_enroll.validity_days,
        'resolution','promotion',
        'resolution_reason','Inscripción incluida con ' || v_product.name
      );
    else
      v_extra_price := v_enroll.price_minor;
      v_extra := jsonb_build_object(
        'type','enrollment',
        'product_template_id',v_enroll.id,
        'name',v_enroll.name,
        'price_minor',v_enroll.price_minor,
        'regular_price_minor',v_enroll.price_minor,
        'currency',upper(v_enroll.currency),
        'validity_days',v_enroll.validity_days,
        'resolution','paid'
      );
    end if;
  end if;

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,provider,client_request_key,
    external_reference,amount_minor,currency,product_name_snapshot,
    validity_days_snapshot,credit_limit_snapshot,unlimited_snapshot,
    package_term_snapshot,regular_amount_minor,reward_discount_minor,
    reward_discount_pct,reward_level_key_snapshot,reward_level_title_snapshot,
    reward_discount_family_snapshot,extra_fulfillment_snapshot
  ) values(
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,'mercado_pago',
    target_client_request_key,'STFLOW-MP-'||v_attempt_id,
    (v_price->>'final_amount_minor')::int+v_extra_price,
    upper(v_product.currency),v_product.name,v_product.validity_days,
    v_product.credit_limit,v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::int+v_extra_regular_price,
    (v_price->>'discount_minor')::int,
    (v_price->>'discount_pct')::int,
    v_price->>'level_key',v_price->>'level_title',
    v_price->>'discount_family',v_extra
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;
  end if;

  return to_jsonb(v_attempt);
end;
$function$
;
revoke all on function public.student_create_online_checkout_attempt(uuid,uuid) from public,anon;
grant execute on function public.student_create_online_checkout_attempt(uuid,uuid) to authenticated;

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

  v_eligibility := private.product_purchase_eligibility(
    v_attempt.studio_id,
    v_attempt.student_id,
    v_attempt.product_template_id
  );
  if coalesce((v_eligibility->>'eligible')::boolean,false) is not true then
    raise exception '%', coalesce(v_eligibility->>'reason_code','product_not_eligible');
  end if;

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
revoke all on function public.service_confirm_online_checkout_approved(uuid,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.service_confirm_online_checkout_approved(uuid,text,text,text,text,text,integer,text) to service_role;

create or replace view public.student_entry_conversion_facts with (security_invoker = true) as
 WITH ranked AS (
         SELECT s.studio_id,
            s.student_id,
            s.id AS sale_id,
            s.created_at AS sale_created_at,
            sl.product_template_id,
            pt.name AS product_name,
            pt.product_type::text AS product_type,
            pt.purchase_eligibility,
            row_number() OVER (PARTITION BY s.studio_id, s.student_id ORDER BY s.created_at, s.id, sl.id) AS rn
           FROM sales s
             JOIN sale_lines sl ON sl.sale_id = s.id AND sl.studio_id = s.studio_id
             JOIN product_templates pt ON pt.id = sl.product_template_id AND pt.studio_id = sl.studio_id
          WHERE s.status = 'confirmed'::sale_status AND (pt.product_type::text = ANY (ARRAY['single_class'::text, 'package'::text, 'membership'::text]))
        ), entry AS (
         SELECT ranked.studio_id,
            ranked.student_id,
            ranked.sale_id,
            ranked.sale_created_at,
            ranked.product_template_id,
            ranked.product_name,
            ranked.product_type,
            ranked.purchase_eligibility,
            ranked.rn
           FROM ranked
          WHERE ranked.rn = 1
        ), conversion AS (
         SELECT e_1.studio_id,
            e_1.student_id,
            min(s.created_at) AS converted_at
           FROM entry e_1
             JOIN sales s ON s.studio_id = e_1.studio_id AND s.student_id = e_1.student_id AND s.status = 'confirmed'::sale_status
             JOIN sale_lines sl ON sl.sale_id = s.id AND sl.studio_id = s.studio_id
             JOIN product_templates pt ON pt.id = sl.product_template_id AND pt.studio_id = sl.studio_id
          WHERE s.created_at > e_1.sale_created_at AND (pt.product_type::text = ANY (ARRAY['package'::text, 'membership'::text])) AND pt.purchase_eligibility = 'all'::text
          GROUP BY e_1.studio_id, e_1.student_id
        )
 SELECT e.studio_id,
    e.student_id,
    st.person_id,
    st.acquisition_source,
    e.sale_id AS first_sale_id,
    e.sale_created_at AS first_purchase_at,
    e.product_template_id AS first_product_template_id,
    e.product_name AS first_product_name,
    e.product_type AS first_product_type,
        CASE
            WHEN e.product_type = 'single_class'::text THEN 'single_class'::text
            WHEN e.purchase_eligibility = 'new_customer'::text THEN 'introductory_package'::text
            WHEN e.product_type = ANY (ARRAY['package'::text, 'membership'::text]) THEN 'regular_package'::text
            ELSE e.product_type
        END AS entry_mode,
    c.converted_at AS regular_package_converted_at,
        CASE
            WHEN c.converted_at IS NOT NULL THEN true
            ELSE false
        END AS converted_to_regular_package,
        CASE
            WHEN c.converted_at IS NULL THEN NULL::integer
            ELSE GREATEST(0::numeric, floor(EXTRACT(epoch FROM c.converted_at - e.sale_created_at) / 86400::numeric))::integer
        END AS days_to_regular_package
   FROM entry e
     JOIN students st ON st.id = e.student_id AND st.studio_id = e.studio_id
     LEFT JOIN conversion c ON c.studio_id = e.studio_id AND c.student_id = e.student_id;;
revoke all on public.student_entry_conversion_facts from public,anon,authenticated;
grant select on public.student_entry_conversion_facts to authenticated;
