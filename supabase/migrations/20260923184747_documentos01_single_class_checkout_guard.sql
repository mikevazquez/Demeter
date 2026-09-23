CREATE OR REPLACE FUNCTION public.student_create_single_class_checkout_attempt(target_session_id uuid, target_client_request_key uuid)
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
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
  v_blockers jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_session_id is null then raise exception 'session_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id=target_session_id
    and cs.studio_id=v_student.studio_id
    and cs.status='scheduled'
    and cs.starts_at>now();

  if not found then raise exception 'session_not_bookable'; end if;

  v_blockers := private.student_booking_blockers(v_student.id, v_session.id);
  if jsonb_array_length(coalesce(v_blockers,'[]'::jsonb)) > 0 then
    raise exception '%', coalesce(v_blockers->0->>'code','account_restricted');
  end if;

  if (
    select count(*)
    from public.reservations r
    where r.session_id=v_session.id
      and r.status in ('reserved','attended')
  ) >= v_session.capacity then
    raise exception 'session_full';
  end if;

  select ct.* into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_student.studio_id
    and ct.active=true;

  if not found then raise exception 'activity_not_available'; end if;
  if coalesce(v_template.drop_in_price_minor,0)<=0 then
    raise exception 'single_class_price_missing';
  end if;

  select pt.* into v_product
  from public.product_templates pt
  join public.product_template_disciplines ptd
    on ptd.product_template_id=pt.id
   and ptd.studio_id=pt.studio_id
  where pt.studio_id=v_student.studio_id
    and pt.product_type='single_class'::public.product_type
    and pt.active=true
    and pt.online_purchasable=true
    and pt.price_minor=v_template.drop_in_price_minor
    and coalesce(pt.credit_limit,0)=1
    and coalesce(pt.validity_days,0)>0
    and ptd.discipline_id=v_template.discipline_id
  order by pt.created_at asc
  limit 1;

  if not found then raise exception 'single_class_product_not_available'; end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,session_id,provider,
    client_request_key,external_reference,amount_minor,currency,
    product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,
    unlimited_snapshot,package_term_snapshot,regular_amount_minor,
    reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,
    reward_level_title_snapshot,reward_discount_family_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,v_session.id,
    'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer,upper(v_product.currency),
    v_product.name,v_product.validity_days,v_product.credit_limit,
    v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',
    v_price->>'level_title',
    v_price->>'discount_family'
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;

    if v_attempt.product_template_id<>v_product.id
       or v_attempt.session_id is distinct from v_session.id then
      raise exception 'request_key_reused_for_different_purchase';
    end if;
  end if;

  return jsonb_build_object(
    'id',v_attempt.id,
    'external_reference',v_attempt.external_reference,
    'product_template_id',v_attempt.product_template_id,
    'session_id',v_attempt.session_id,
    'amount_minor',v_attempt.amount_minor,
    'regular_amount_minor',v_attempt.regular_amount_minor,
    'reward_discount_minor',v_attempt.reward_discount_minor,
    'reward_discount_pct',v_attempt.reward_discount_pct,
    'reward_level_key',v_attempt.reward_level_key_snapshot,
    'reward_level_title',v_attempt.reward_level_title_snapshot,
    'reward_discount_family',v_attempt.reward_discount_family_snapshot,
    'currency',v_attempt.currency,
    'status',v_attempt.status::text,
    'provider_order_id',v_attempt.provider_order_id,
    'checkout_url',v_attempt.checkout_url,
    'created_at',v_attempt.created_at
  );
end;
$function$
;
