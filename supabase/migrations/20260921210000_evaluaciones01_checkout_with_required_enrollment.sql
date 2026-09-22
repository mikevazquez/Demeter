alter table public.online_checkout_attempts
  add column if not exists extra_fulfillment_snapshot jsonb;

alter table public.online_checkout_attempts
  drop constraint if exists online_checkout_attempts_extra_fulfillment_object;

alter table public.online_checkout_attempts
  add constraint online_checkout_attempts_extra_fulfillment_object
  check (
    extra_fulfillment_snapshot is null
    or jsonb_typeof(extra_fulfillment_snapshot) = 'object'
  );

create or replace function public.student_enrollment_checkout_requirement(target_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_class_date date;
  v_has_enrollment boolean := false;
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

  select coalesce(st.timezone,'America/Mexico_City')
  into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  if not found or not v_policy.enabled or not v_policy.required_for_booking then
    return jsonb_build_object('required',false,'missing',false);
  end if;

  select exists(
    select 1
    from public.student_enrollments se
    where se.studio_id=v_student.studio_id
      and se.student_id=v_student.id
      and se.status='active'
      and se.starts_on<=v_class_date
      and (se.expires_on is null or se.expires_on>=v_class_date)
  ) into v_has_enrollment;

  if v_has_enrollment then
    return jsonb_build_object('required',true,'missing',false);
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
    'product_template_id',v_product.id,
    'name',v_product.name,
    'price_minor',v_product.price_minor,
    'currency',upper(v_product.currency),
    'validity_days',v_product.validity_days
  );
end;
$$;

revoke all on function public.student_enrollment_checkout_requirement(uuid)
from public,anon;
grant execute on function public.student_enrollment_checkout_requirement(uuid)
to authenticated;

create or replace function public.student_create_evaluation_checkout_attempt(
  target_invitation_id uuid,
  target_session_id uuid,
  target_product_template_id uuid,
  target_client_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_invitation public.evaluation_invitations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_class_date date;
  v_price jsonb;
  v_extra jsonb := null;
  v_extra_price integer := 0;
  v_has_enrollment boolean := false;
  v_is_single boolean := target_product_template_id is null;
  v_booked_count integer;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_invitation_id is null then raise exception 'evaluation_invitation_required'; end if;
  if target_session_id is null then raise exception 'session_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;
  if not found then raise exception 'student_context_not_found'; end if;

  select ei.* into v_invitation
  from public.evaluation_invitations ei
  where ei.id=target_invitation_id
    and ei.student_id=v_student.id
    and ei.studio_id=v_student.studio_id
    and ei.status='pending_schedule';
  if not found then raise exception 'evaluation_invitation_not_schedulable'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id=target_session_id
    and cs.studio_id=v_student.studio_id
    and cs.status='scheduled'
    and cs.starts_at>now();
  if not found then raise exception 'session_not_bookable'; end if;

  select ct.* into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_student.studio_id
    and ct.active=true;
  if not found then raise exception 'activity_not_available'; end if;

  if v_template.discipline_id is distinct from v_invitation.discipline_id then
    raise exception 'evaluation_session_wrong_discipline';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_class_date := (v_session.starts_at at time zone v_timezone)::date;

  if v_class_date < v_invitation.window_start or v_class_date > v_invitation.window_end then
    raise exception 'evaluation_session_outside_window';
  end if;

  select count(*)::integer into v_booked_count
  from public.reservations r
  where r.session_id=v_session.id
    and r.status in ('reserved','attended');

  if v_booked_count>=v_session.capacity then raise exception 'session_full'; end if;

  if v_is_single then
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
  else
    select pt.* into v_product
    from public.product_templates pt
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pt.id
     and ptd.studio_id=pt.studio_id
    where pt.id=target_product_template_id
      and pt.studio_id=v_student.studio_id
      and pt.active=true
      and pt.online_purchasable=true
      and pt.product_type::text in ('package','membership')
      and ptd.discipline_id=v_template.discipline_id;
    if not found then raise exception 'product_not_available_online'; end if;
  end if;

  if v_product.price_minor<=0 then raise exception 'online_price_invalid'; end if;
  if v_product.validity_days is null or v_product.validity_days<=0 then
    raise exception 'product_validity_missing';
  end if;

  v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists(
      select 1
      from public.student_enrollments se
      where se.studio_id=v_student.studio_id
        and se.student_id=v_student.id
        and se.status='active'
        and se.starts_on<=v_class_date
        and (se.expires_on is null or se.expires_on>=v_class_date)
    ) into v_has_enrollment;

    if not v_has_enrollment then
      select * into v_enrollment_product
      from public.product_templates pt
      where pt.id=v_policy.enrollment_product_template_id
        and pt.studio_id=v_student.studio_id
        and pt.active=true
        and pt.product_type='enrollment'::public.product_type;
      if not found then raise exception 'enrollment_product_not_configured'; end if;
      if coalesce(v_enrollment_product.price_minor,0)<=0 then
        raise exception 'online_price_invalid';
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
$$;

revoke all on function public.student_create_evaluation_checkout_attempt(uuid,uuid,uuid,uuid)
from public,anon;
grant execute on function public.student_create_evaluation_checkout_attempt(uuid,uuid,uuid,uuid)
to authenticated;

create or replace function public.service_confirm_online_checkout_approved(
  target_attempt_id uuid,
  target_provider_order_id text,
  target_provider_payment_id text,
  target_external_reference text,
  target_provider_status text,
  target_provider_status_detail text,
  target_paid_amount_minor integer,
  target_currency text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
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
  v_main_amount integer;
  v_enrollment_product_id uuid;
  v_enrollment_name text;
  v_enrollment_validity_days integer;
begin
  if target_attempt_id is null then raise exception 'attempt_required'; end if;
  if nullif(trim(coalesce(target_provider_order_id, '')), '') is null then
    raise exception 'provider_order_required';
  end if;
  if nullif(trim(coalesce(target_provider_payment_id, '')), '') is null then
    raise exception 'provider_payment_required';
  end if;
  if nullif(trim(coalesce(target_external_reference, '')), '') is null then
    raise exception 'external_reference_required';
  end if;
  if coalesce(target_paid_amount_minor, 0) <= 0 then raise exception 'paid_amount_invalid'; end if;

  select * into v_attempt
  from public.online_checkout_attempts
  where id = target_attempt_id
    and provider = 'mercado_pago'
  for update;

  if not found then raise exception 'checkout_attempt_not_found'; end if;

  if v_attempt.processed_at is not null or v_attempt.sale_id is not null then
    if v_attempt.provider_order_id is distinct from target_provider_order_id then
      raise exception 'provider_order_mismatch';
    end if;
    if v_attempt.provider_payment_id is not null
       and v_attempt.provider_payment_id is distinct from target_provider_payment_id then
      raise exception 'provider_payment_mismatch';
    end if;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'attempt_id', v_attempt.id,
      'sale_id', v_attempt.sale_id,
      'provider_payment_id', v_attempt.provider_payment_id
    );
  end if;

  if v_attempt.provider_order_id is distinct from target_provider_order_id then
    raise exception 'provider_order_mismatch';
  end if;
  if v_attempt.external_reference is distinct from target_external_reference then
    raise exception 'external_reference_mismatch';
  end if;
  if lower(coalesce(target_provider_status, '')) <> 'processed'
     or lower(coalesce(target_provider_status_detail, '')) <> 'accredited' then
    raise exception 'provider_not_approved';
  end if;
  if v_attempt.amount_minor <> target_paid_amount_minor then raise exception 'paid_amount_mismatch'; end if;
  if upper(v_attempt.currency) <> upper(coalesce(target_currency, '')) then
    raise exception 'currency_mismatch';
  end if;
  if v_attempt.validity_days_snapshot is null or v_attempt.validity_days_snapshot <= 0 then
    raise exception 'product_validity_missing';
  end if;

  v_extra := v_attempt.extra_fulfillment_snapshot;
  if v_extra is not null then
    if v_extra->>'type' <> 'enrollment' then raise exception 'extra_fulfillment_invalid'; end if;
    v_extra_price := coalesce((v_extra->>'price_minor')::integer,0);
    v_enrollment_product_id := (v_extra->>'product_template_id')::uuid;
    v_enrollment_name := nullif(v_extra->>'name','');
    v_enrollment_validity_days := nullif(v_extra->>'validity_days','')::integer;
    if v_extra_price<=0 or v_enrollment_product_id is null or v_enrollment_name is null then
      raise exception 'extra_fulfillment_invalid';
    end if;
  end if;

  v_main_amount := v_attempt.amount_minor - v_extra_price;
  if v_main_amount<=0 then raise exception 'checkout_amount_invalid'; end if;

  select timezone into v_timezone
  from public.studios
  where id = v_attempt.studio_id;

  v_sale_date := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;
  v_folio := 'MP-' || to_char(v_sale_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_attempt.id::text, '-', ''), 1, 12));

  insert into public.sales(
    id,studio_id,student_id,folio,currency,total_minor,created_by
  ) values (
    v_sale_id,v_attempt.studio_id,v_attempt.student_id,v_folio,
    v_attempt.currency,v_attempt.amount_minor,null
  );

  insert into public.sale_lines(
    studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
  ) values (
    v_attempt.studio_id,v_sale_id,v_attempt.product_template_id,
    v_attempt.product_name_snapshot,1,v_main_amount,v_main_amount
  ) returning id into v_sale_line_id;

  insert into public.product_acquisitions(
    studio_id,student_id,product_template_id,status,starts_on,expires_on,
    credit_limit,unlimited,sale_line_id
  ) values (
    v_attempt.studio_id,v_attempt.student_id,v_attempt.product_template_id,'active',
    v_sale_date,v_sale_date + v_attempt.validity_days_snapshot,
    v_attempt.credit_limit_snapshot,v_attempt.unlimited_snapshot,v_sale_line_id
  ) returning id into v_acquisition_id;

  if not v_attempt.unlimited_snapshot and coalesce(v_attempt.credit_limit_snapshot, 0) > 0 then
    insert into public.credit_ledger(
      studio_id,acquisition_id,movement_type,quantity,note,created_by
    ) values (
      v_attempt.studio_id,v_acquisition_id,'grant',
      v_attempt.credit_limit_snapshot,'Venta Mercado Pago ' || v_folio,null
    );
  end if;

  if v_extra is not null then
    insert into public.sale_lines(
      studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
    ) values (
      v_attempt.studio_id,v_sale_id,v_enrollment_product_id,v_enrollment_name,
      1,v_extra_price,v_extra_price
    ) returning id into v_enrollment_sale_line_id;

    insert into public.student_enrollments(
      studio_id,student_id,status,starts_on,expires_on,source_sale_id,
      source_sale_line_id,created_by
    ) values (
      v_attempt.studio_id,v_attempt.student_id,'active',v_sale_date,
      case
        when v_enrollment_validity_days is null then null
        else v_sale_date + v_enrollment_validity_days
      end,
      v_sale_id,v_enrollment_sale_line_id,null
    ) returning id into v_enrollment_id;
  end if;

  insert into public.payments(
    studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by
  ) values (
    v_attempt.studio_id,v_sale_id,'payment',v_attempt.amount_minor,
    'mercado_pago',trim(target_provider_payment_id),
    'Mercado Pago Order ' || trim(target_provider_order_id),null
  );

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
    'ok',true,
    'reused',false,
    'attempt_id',v_attempt.id,
    'sale_id',v_sale_id,
    'sale_line_id',v_sale_line_id,
    'acquisition_id',v_acquisition_id,
    'enrollment_id',v_enrollment_id,
    'provider_payment_id',trim(target_provider_payment_id)
  );
end;
$$;
