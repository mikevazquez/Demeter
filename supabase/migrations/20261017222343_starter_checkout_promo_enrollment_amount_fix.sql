-- Keep promotional enrollment value in the enrollment snapshot without inflating the checkout regular amount.
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
    (v_price->>'regular_amount_minor')::int+v_extra_price,
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
