-- Studio Flow · Inscripción V2
-- One enrollment rule: when enabled, enrollment is required for booking,
-- package purchases and single-class purchases. No automatic grace purchase.

alter table public.enrollment_policies
  add column if not exists required_for_package_purchase boolean not null default false,
  add column if not exists required_for_single_class boolean not null default false,
  add column if not exists single_class_grace_count integer not null default 0;

do $$
begin
  alter table public.enrollment_policies
    add constraint enrollment_policies_single_class_grace_nonnegative
    check (single_class_grace_count >= 0);
exception when duplicate_object then null;
end $$;

update public.enrollment_policies
set required_for_booking = enabled,
    required_for_package_purchase = enabled,
    required_for_single_class = enabled,
    single_class_grace_count = 0,
    updated_at = now();

CREATE OR REPLACE FUNCTION private.student_has_active_enrollment(p_studio_id uuid, p_student_id uuid, p_on_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(
    select 1
    from public.student_enrollments se
    where se.studio_id=p_studio_id
      and se.student_id=p_student_id
      and se.status='active'
      and se.starts_on<=p_on_date
      and (se.expires_on is null or se.expires_on>=p_on_date)
  );
$function$;

CREATE OR REPLACE FUNCTION private.student_single_class_purchase_count(p_studio_id uuid, p_student_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
  from public.product_acquisitions pa
  join public.product_templates pt
    on pt.id=pa.product_template_id
   and pt.studio_id=pa.studio_id
  where pa.studio_id=p_studio_id
    and pa.student_id=p_student_id
    and pt.product_type='single_class'::public.product_type
    and pa.refunded_at is null;
$function$;

CREATE OR REPLACE FUNCTION private.student_enrollment_requirement_for_booking(p_student_id uuid, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_timezone text;
  v_class_date date;
  v_discipline_id uuid;
  v_has_enrollment boolean := false;
  v_has_package_like boolean := false;
  v_has_single_class boolean := false;
  v_single_count integer := 0;
begin
  select * into v_session
  from public.class_sessions
  where id=p_session_id;

  if not found then
    return jsonb_build_object('required',false,'missing',false,'reason','session_not_found');
  end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_session.studio_id;

  if not found or not v_policy.enabled then
    return jsonb_build_object('required',false,'missing',false,'mode','disabled');
  end if;

  select st.timezone into v_timezone
  from public.studios st
  where st.id=v_session.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;

  if private.student_has_active_enrollment(
    v_session.studio_id,
    p_student_id,
    v_class_date
  ) then
    return jsonb_build_object('required',true,'missing',false,'mode','active');
  end if;

  select ct.discipline_id into v_discipline_id
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_session.studio_id;

  select exists(
    select 1
    from public.product_acquisitions pa
    join public.product_templates pt
      on pt.id=pa.product_template_id
     and pt.studio_id=pa.studio_id
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pt.id
     and ptd.studio_id=pt.studio_id
    where pa.studio_id=v_session.studio_id
      and pa.student_id=p_student_id
      and pa.status='active'
      and not pa.access_blocked
      and pt.product_type in ('package'::public.product_type,'membership'::public.product_type)
      and ptd.discipline_id=v_discipline_id
      and (
        (pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date)
      )
  ) into v_has_package_like;

  select exists(
    select 1
    from public.product_acquisitions pa
    join public.product_templates pt
      on pt.id=pa.product_template_id
     and pt.studio_id=pa.studio_id
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pt.id
     and ptd.studio_id=pt.studio_id
    where pa.studio_id=v_session.studio_id
      and pa.student_id=p_student_id
      and pa.status='active'
      and not pa.access_blocked
      and pt.product_type='single_class'::public.product_type
      and ptd.discipline_id=v_discipline_id
      and (
        (pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date)
      )
  ) into v_has_single_class;

  v_single_count := private.student_single_class_purchase_count(
    v_session.studio_id,
    p_student_id
  );

  if v_has_package_like and v_policy.required_for_booking then
    return jsonb_build_object(
      'required',true,'missing',true,'mode','package_booking'
    );
  end if;

  if v_policy.required_for_single_class and v_has_single_class then
    if v_single_count<=v_policy.single_class_grace_count then
      return jsonb_build_object(
        'required',false,'missing',false,'mode','single_class_grace',
        'single_class_count',v_single_count,
        'grace_count',v_policy.single_class_grace_count
      );
    end if;

    return jsonb_build_object(
      'required',true,'missing',true,'mode','single_class_booking',
      'single_class_count',v_single_count,
      'grace_count',v_policy.single_class_grace_count
    );
  end if;

  if v_policy.required_for_single_class
     and not v_has_package_like
     and not v_has_single_class
     and v_single_count>=v_policy.single_class_grace_count then
    return jsonb_build_object(
      'required',true,'missing',true,'mode','single_class_next_purchase',
      'single_class_count',v_single_count,
      'grace_count',v_policy.single_class_grace_count
    );
  end if;

  return jsonb_build_object(
    'required',false,'missing',false,'mode','not_required',
    'single_class_count',v_single_count,
    'grace_count',v_policy.single_class_grace_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_enrollment_policy_v2(target_studio_id uuid, target_enabled boolean, target_required_for_booking boolean, target_required_for_package_purchase boolean, target_required_for_single_class boolean, target_single_class_grace_count integer, target_product_template_id uuid, target_rules jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.product_templates%rowtype;
  v_rules jsonb := coalesce(target_rules,'{}'::jsonb);
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  if jsonb_typeof(v_rules)<>'object' then raise exception 'enrollment_rules_invalid'; end if;
  if coalesce(target_single_class_grace_count,-1)<0
     or target_single_class_grace_count>100 then
    raise exception 'single_class_grace_invalid';
  end if;

  if target_enabled then
    if target_product_template_id is null then raise exception 'enrollment_product_required'; end if;

    select * into v_product
    from public.product_templates
    where id=target_product_template_id
      and studio_id=target_studio_id
      and active=true;

    if not found then raise exception 'enrollment_product_not_found'; end if;
    if v_product.product_type<>'enrollment' then raise exception 'enrollment_product_type_required'; end if;
  elsif target_product_template_id is not null then
    select * into v_product
    from public.product_templates
    where id=target_product_template_id
      and studio_id=target_studio_id;

    if not found then raise exception 'enrollment_product_not_found'; end if;
    if v_product.product_type<>'enrollment' then raise exception 'enrollment_product_type_required'; end if;
  end if;

  insert into public.enrollment_policies(
    studio_id,
    enabled,
    required_for_booking,
    required_for_package_purchase,
    required_for_single_class,
    single_class_grace_count,
    enrollment_product_template_id,
    rules,
    updated_at
  )
  values(
    target_studio_id,
    target_enabled,
    target_required_for_booking,
    target_required_for_package_purchase,
    target_required_for_single_class,
    target_single_class_grace_count,
    target_product_template_id,
    v_rules,
    now()
  )
  on conflict(studio_id) do update
  set enabled=excluded.enabled,
      required_for_booking=excluded.required_for_booking,
      required_for_package_purchase=excluded.required_for_package_purchase,
      required_for_single_class=excluded.required_for_single_class,
      single_class_grace_count=excluded.single_class_grace_count,
      enrollment_product_template_id=excluded.enrollment_product_template_id,
      rules=excluded.rules,
      updated_at=now();

  return jsonb_build_object(
    'ok',true,
    'studio_id',target_studio_id,
    'enabled',target_enabled,
    'required_for_booking',target_required_for_booking,
    'required_for_package_purchase',target_required_for_package_purchase,
    'required_for_single_class',target_required_for_single_class,
    'single_class_grace_count',target_single_class_grace_count,
    'product_template_id',target_product_template_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_enrollment_checkout_requirement(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_class_date date;
  v_single_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

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
    and cs.studio_id=v_student.studio_id;

  if not found then raise exception 'session_not_found'; end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  if not found or not v_policy.enabled or not v_policy.required_for_single_class then
    return jsonb_build_object('required',false,'missing',false,'mode','not_required');
  end if;

  select st.timezone into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;

  if private.student_has_active_enrollment(
    v_student.studio_id,
    v_student.id,
    v_class_date
  ) then
    return jsonb_build_object('required',true,'missing',false,'mode','active');
  end if;

  v_single_count := private.student_single_class_purchase_count(
    v_student.studio_id,
    v_student.id
  );

  if v_single_count < v_policy.single_class_grace_count then
    return jsonb_build_object(
      'required',false,
      'missing',false,
      'mode','single_class_grace',
      'single_class_count',v_single_count,
      'grace_count',v_policy.single_class_grace_count,
      'grace_remaining',v_policy.single_class_grace_count-v_single_count
    );
  end if;

  select * into v_product
  from public.product_templates pt
  where pt.id=v_policy.enrollment_product_template_id
    and pt.studio_id=v_student.studio_id
    and pt.active=true
    and pt.product_type='enrollment'::public.product_type;

  if not found then raise exception 'enrollment_product_not_configured'; end if;
  if coalesce(v_product.price_minor,0)<=0 then raise exception 'online_price_invalid'; end if;

  return jsonb_build_object(
    'required',true,
    'missing',true,
    'mode','single_class_required',
    'single_class_count',v_single_count,
    'grace_count',v_policy.single_class_grace_count,
    'product_template_id',v_product.id,
    'name',v_product.name,
    'price_minor',v_product.price_minor,
    'currency',upper(v_product.currency),
    'validity_days',v_product.validity_days
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_create_enrollment_checkout_attempt(target_product_template_id uuid, target_client_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_student public.students%rowtype; v_product public.product_templates%rowtype; v_attempt public.online_checkout_attempts%rowtype; v_id uuid:=gen_random_uuid(); v_tz text; v_today date; begin if auth.uid() is null then raise exception 'unauthenticated'; end if; select s.* into v_student from public.students s where s.user_id=auth.uid() and private.is_current_student(s.id,s.studio_id) order by s.created_at limit 1; if not found then raise exception 'student_context_not_found'; end if; select * into v_product from public.product_templates where id=target_product_template_id and studio_id=v_student.studio_id and active and product_type='enrollment'; if not found then raise exception 'product_not_available_online'; end if; select coalesce(timezone,'America/Mexico_City') into v_tz from public.studios where id=v_student.studio_id; v_today:=(clock_timestamp() at time zone v_tz)::date; if private.student_has_active_enrollment(v_student.studio_id,v_student.id,v_today) then raise exception 'enrollment_already_active'; end if; insert into public.online_checkout_attempts(id,studio_id,student_id,product_template_id,provider,client_request_key,external_reference,amount_minor,currency,product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,unlimited_snapshot,package_term_snapshot,regular_amount_minor) values(v_id,v_student.studio_id,v_student.id,v_product.id,'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_id,v_product.price_minor,upper(v_product.currency),v_product.name,coalesce(v_product.validity_days,2147483647),null,false,null,v_product.price_minor) returning * into v_attempt; return to_jsonb(v_attempt); end $function$;

CREATE OR REPLACE FUNCTION public.student_create_online_checkout_attempt(target_product_template_id uuid, target_client_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_student public.students%rowtype; v_product public.product_templates%rowtype; v_enroll public.product_templates%rowtype; v_attempt public.online_checkout_attempts%rowtype; v_attempt_id uuid:=gen_random_uuid(); v_timezone text; v_today date; v_price jsonb; v_policy public.enrollment_policies%rowtype; v_extra jsonb:=null; v_extra_price int:=0; begin if auth.uid() is null then raise exception 'unauthenticated'; end if; select s.* into v_student from public.students s where s.user_id=auth.uid() and private.is_current_student(s.id,s.studio_id) order by s.created_at limit 1; if not found then raise exception 'student_context_not_found'; end if; select pt.* into v_product from public.product_templates pt where pt.id=target_product_template_id and pt.studio_id=v_student.studio_id and pt.active and pt.online_purchasable and pt.product_type::text in ('package','membership'); if not found then raise exception 'product_not_available_online'; end if; select coalesce(st.timezone,'America/Mexico_City') into v_timezone from public.studios st where st.id=v_student.studio_id; v_today:=(clock_timestamp() at time zone v_timezone)::date; v_price:=private.reward_checkout_price(v_student.id,v_product.id,v_today); select * into v_policy from public.enrollment_policies where studio_id=v_student.studio_id; if found and v_policy.enabled and v_policy.required_for_package_purchase and not private.student_has_active_enrollment(v_student.studio_id,v_student.id,v_today) then select * into v_enroll from public.product_templates where id=v_policy.enrollment_product_template_id and studio_id=v_student.studio_id and active and product_type='enrollment'; if not found then raise exception 'enrollment_product_not_configured'; end if; v_extra_price:=v_enroll.price_minor; v_extra:=jsonb_build_object('type','enrollment','product_template_id',v_enroll.id,'name',v_enroll.name,'price_minor',v_enroll.price_minor,'currency',upper(v_enroll.currency),'validity_days',v_enroll.validity_days); end if; insert into public.online_checkout_attempts(id,studio_id,student_id,product_template_id,provider,client_request_key,external_reference,amount_minor,currency,product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,unlimited_snapshot,package_term_snapshot,regular_amount_minor,reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,reward_level_title_snapshot,reward_discount_family_snapshot,extra_fulfillment_snapshot) values(v_attempt_id,v_student.studio_id,v_student.id,v_product.id,'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id,(v_price->>'final_amount_minor')::int+v_extra_price,upper(v_product.currency),v_product.name,v_product.validity_days,v_product.credit_limit,v_product.unlimited,v_product.package_term,(v_price->>'regular_amount_minor')::int+v_extra_price,(v_price->>'discount_minor')::int,(v_price->>'discount_pct')::int,v_price->>'level_key',v_price->>'level_title',v_price->>'discount_family',v_extra) on conflict(student_id,client_request_key) do nothing returning * into v_attempt; if v_attempt.id is null then select * into v_attempt from public.online_checkout_attempts where student_id=v_student.id and client_request_key=target_client_request_key; end if; return to_jsonb(v_attempt); end $function$;

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
  v_enrollment_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
  v_blockers jsonb;
  v_enrollment_requirement jsonb;
  v_extra jsonb := null;
  v_extra_price integer := 0;
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

  v_enrollment_requirement :=
    public.student_enrollment_checkout_requirement(target_session_id);

  if coalesce((v_enrollment_requirement->>'missing')::boolean,false) then
    select pt.* into v_enrollment_product
    from public.product_templates pt
    where pt.id=(v_enrollment_requirement->>'product_template_id')::uuid
      and pt.studio_id=v_student.studio_id
      and pt.active=true
      and pt.product_type='enrollment'::public.product_type;

    if not found then raise exception 'enrollment_product_not_configured'; end if;
    if coalesce(v_enrollment_product.price_minor,0)<=0 then
      raise exception 'online_price_invalid';
    end if;
    if upper(v_enrollment_product.currency)<>upper(v_product.currency) then
      raise exception 'enrollment_currency_mismatch';
    end if;

    v_extra_price := v_enrollment_product.price_minor;
    v_extra := jsonb_build_object(
      'type','enrollment',
      'product_template_id',v_enrollment_product.id,
      'name',v_enrollment_product.name,
      'price_minor',v_enrollment_product.price_minor,
      'currency',upper(v_enrollment_product.currency),
      'validity_days',v_enrollment_product.validity_days
    );
  end if;

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,session_id,provider,
    client_request_key,external_reference,amount_minor,currency,
    product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,
    unlimited_snapshot,package_term_snapshot,regular_amount_minor,
    reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,
    reward_level_title_snapshot,reward_discount_family_snapshot,
    extra_fulfillment_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,v_session.id,
    'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer + v_extra_price,
    upper(v_product.currency),v_product.name,v_product.validity_days,
    v_product.credit_limit,v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer + v_extra_price,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',
    v_price->>'level_title',
    v_price->>'discount_family',
    v_extra
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
    'extra_fulfillment_snapshot',v_attempt.extra_fulfillment_snapshot,
    'created_at',v_attempt.created_at
  );
end;
$function$;

revoke all on function private.student_has_active_enrollment(uuid,uuid,date)
  from public, anon, authenticated, service_role;
revoke all on function private.student_single_class_purchase_count(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.student_enrollment_requirement_for_booking(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.set_enrollment_policy_v2(
  uuid,boolean,boolean,boolean,boolean,integer,uuid,jsonb
) from public, anon;
grant execute on function public.set_enrollment_policy_v2(
  uuid,boolean,boolean,boolean,boolean,integer,uuid,jsonb
) to authenticated;

revoke all on function public.student_enrollment_checkout_requirement(uuid)
  from public, anon;
grant execute on function public.student_enrollment_checkout_requirement(uuid)
  to authenticated;

revoke all on function public.student_create_enrollment_checkout_attempt(uuid,uuid)
  from public, anon;
grant execute on function public.student_create_enrollment_checkout_attempt(uuid,uuid)
  to authenticated;

revoke all on function public.student_create_online_checkout_attempt(uuid,uuid)
  from public, anon;
grant execute on function public.student_create_online_checkout_attempt(uuid,uuid)
  to authenticated;

revoke all on function public.student_create_single_class_checkout_attempt(uuid,uuid)
  from public, anon;
grant execute on function public.student_create_single_class_checkout_attempt(uuid,uuid)
  to authenticated;
