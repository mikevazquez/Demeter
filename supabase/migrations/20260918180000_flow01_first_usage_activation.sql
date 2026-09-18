
alter table public.product_acquisitions
  drop constraint if exists flow01_acquisition_activation_mode,
  drop constraint if exists flow01_acquisition_dates;

update public.product_acquisitions
set activation_mode='first_usage',updated_at=now()
where activation_mode='first_attendance';

alter table public.product_acquisitions
  add constraint flow01_acquisition_activation_mode
    check (activation_mode in ('fixed_date','first_usage')),
  add constraint flow01_acquisition_dates
    check (
      (activation_mode='fixed_date' and starts_on is not null and expires_on is not null)
      or
      (activation_mode='first_usage' and (
        (starts_on is null and expires_on is null)
        or
        (starts_on is not null and expires_on is not null)
      ))
    );


create or replace function private.activate_acquisition_on_first_usage(
  target_acquisition_id uuid,
  target_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_validity_days integer;
  v_timezone text;
  v_session_starts_at timestamptz;
  v_effective_date date;
begin
  select * into v_acquisition
  from public.product_acquisitions
  where id=target_acquisition_id
  for update;

  if not found
     or v_acquisition.activation_mode<>'first_usage'
     or v_acquisition.starts_on is not null
     or coalesce(v_acquisition.access_blocked,false) then
    return false;
  end if;

  v_validity_days := v_acquisition.validity_days_snapshot;
  if v_validity_days is null then raise exception 'product_validity_missing'; end if;

  select coalesce(s.timezone,'America/Mexico_City')
  into v_timezone
  from public.studios s
  where s.id=v_acquisition.studio_id;

  if target_reservation_id is not null then
    select cs.starts_at
    into v_session_starts_at
    from public.reservations r
    join public.class_sessions cs
      on cs.id=r.session_id
     and cs.studio_id=r.studio_id
    where r.id=target_reservation_id
      and r.acquisition_id=target_acquisition_id;
  end if;

  v_effective_date := case
    when v_session_starts_at is not null
      then (v_session_starts_at at time zone coalesce(v_timezone,'America/Mexico_City'))::date
    else (now() at time zone coalesce(v_timezone,'America/Mexico_City'))::date
  end;

  update public.product_acquisitions
  set starts_on=v_effective_date,
      expires_on=v_effective_date+v_validity_days,
      updated_at=now()
  where id=v_acquisition.id
    and activation_mode='first_usage'
    and starts_on is null;

  return found;
end;
$$;


CREATE OR REPLACE FUNCTION public.create_student_onboarding_sale(target_student_id uuid, target_package_product_id uuid, target_idempotency_key uuid, package_start_mode text, package_starts_on date, package_discount_minor integer, package_discount_kind text, package_discount_input text, package_discount_reason text, enrollment_resolution text, enrollment_effective_on date, enrollment_reason text, initial_payment_minor integer, payment_method text, payment_effective_on date, payment_reference text, payment_notes text, payment_due_on date, collection_note text, allow_pending_access boolean, pending_access_reason text, prior_credits_used integer, prior_credits_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_package public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_has_policy boolean := false;
  v_has_current_enrollment boolean := false;
  v_products uuid[];
  v_core jsonb;
  v_sale_id uuid;
  v_existing_sale public.sales%rowtype;
  v_package_line_id uuid;
  v_acquisition_id uuid;
  v_enrollment_line_id uuid;
  v_enrollment_id uuid;
  v_timezone text;
  v_today date;
  v_core_start date;
  v_total integer := 0;
  v_paid integer := greatest(coalesce(initial_payment_minor,0),0);
  v_balance integer := 0;
  v_access_blocked boolean := false;
  v_prior integer := greatest(coalesce(prior_credits_used,0),0);
  v_current_balance integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_idempotency_key is null then raise exception 'idempotency_key_required'; end if;

  select * into v_student
  from public.students
  where id=target_student_id
  for update;

  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then raise exception 'student_not_operable'; end if;
  if not private.has_capability(v_student.studio_id,'sales.write') then raise exception 'forbidden'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_idempotency_key::text,0)
  );

  select * into v_existing_sale
  from public.sales
  where studio_id=v_student.studio_id
    and idempotency_key=target_idempotency_key
  limit 1;

  if found then
    select coalesce(sum(case when p.kind='payment' then p.amount_minor else -p.amount_minor end),0)::integer
    into v_paid
    from public.payments p
    where p.sale_id=v_existing_sale.id;

    return jsonb_build_object(
      'ok',true,'replayed',true,'sale_id',v_existing_sale.id,
      'total_minor',v_existing_sale.total_minor,'paid_minor',greatest(v_paid,0),
      'balance_minor',greatest(v_existing_sale.total_minor-v_paid,0)
    );
  end if;

  select * into v_package
  from public.product_templates
  where id=target_package_product_id
    and studio_id=v_student.studio_id
    and active=true
    and product_type='package';

  if not found then raise exception 'package_not_available'; end if;
  if v_package.validity_days is null then raise exception 'product_validity_missing'; end if;

  if package_start_mode not in ('today','specific','first_usage') then
    raise exception 'package_start_mode_invalid';
  end if;

  select timezone into v_timezone from public.studios where id=v_student.studio_id;
  v_today := (now() at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  if package_start_mode='specific' then
    if package_starts_on is null then raise exception 'package_start_date_required'; end if;
    v_core_start := package_starts_on;
  else
    v_core_start := v_today;
  end if;

  if coalesce(package_discount_minor,0)<0 or package_discount_minor>v_package.price_minor then
    raise exception 'discount_invalid';
  end if;

  if coalesce(package_discount_minor,0)>0 then
    if package_discount_kind not in ('percentage','amount','courtesy') then raise exception 'discount_kind_invalid'; end if;
    if nullif(trim(coalesce(package_discount_reason,'')),'') is null then raise exception 'discount_reason_required'; end if;
  elsif package_discount_kind is not null then
    raise exception 'discount_invalid';
  end if;

  if v_prior>0 then
    if v_package.unlimited then raise exception 'prior_credits_unavailable_for_unlimited'; end if;
    if v_prior>coalesce(v_package.credit_limit,0) then raise exception 'prior_credits_exceed_package'; end if;
    if nullif(trim(coalesce(prior_credits_reason,'')),'') is null then raise exception 'prior_credits_reason_required'; end if;
  end if;

  select * into v_policy from public.enrollment_policies where studio_id=v_student.studio_id;
  v_has_policy := found;

  if v_has_policy and v_policy.enabled and v_policy.required_for_booking then
    select exists(
      select 1
      from public.student_enrollments se
      where se.studio_id=v_student.studio_id and se.student_id=v_student.id and se.status='active'
        and se.starts_on<=v_today and (se.expires_on is null or se.expires_on>=v_today)
    ) into v_has_current_enrollment;

    if v_has_current_enrollment then
      if enrollment_resolution not in ('already_active','not_required') then raise exception 'enrollment_already_active'; end if;
    else
      if enrollment_resolution not in ('paid','promotion','exception') then raise exception 'enrollment_resolution_required'; end if;
      if v_policy.enrollment_product_template_id is null then raise exception 'enrollment_product_not_configured'; end if;

      select * into v_enrollment_product
      from public.product_templates
      where id=v_policy.enrollment_product_template_id
        and studio_id=v_student.studio_id and active=true and product_type='enrollment';

      if not found then raise exception 'enrollment_product_not_configured'; end if;
      if enrollment_effective_on is null then raise exception 'enrollment_effective_date_required'; end if;
      if enrollment_effective_on>v_today then raise exception 'enrollment_effective_date_future'; end if;

      if enrollment_resolution in ('promotion','exception')
         and nullif(trim(coalesce(enrollment_reason,'')),'') is null then
        raise exception 'enrollment_reason_required';
      end if;
    end if;
  else
    if enrollment_resolution not in ('not_required','already_active') then raise exception 'enrollment_not_required'; end if;
  end if;

  v_products := array[v_package.id];
  if v_has_policy and v_policy.enabled and v_policy.required_for_booking
     and not v_has_current_enrollment
     and enrollment_resolution in ('paid','promotion','exception') then
    v_products := array_append(v_products,v_enrollment_product.id);
  end if;

  v_core := private.create_manual_sale_core(v_student.id,v_products,0,null,null,null,v_core_start);
  v_sale_id := (v_core->>'sale_id')::uuid;

  select sl.id,pa.id into v_package_line_id,v_acquisition_id
  from public.sale_lines sl
  join public.product_acquisitions pa on pa.sale_line_id=sl.id
  where sl.sale_id=v_sale_id and sl.product_template_id=v_package.id
  limit 1;

  if v_package_line_id is null or v_acquisition_id is null then raise exception 'package_acquisition_missing'; end if;

  update public.sale_lines
  set discount_minor=coalesce(package_discount_minor,0),
      discount_kind=case when coalesce(package_discount_minor,0)>0 then package_discount_kind else null end,
      discount_input=case when coalesce(package_discount_minor,0)>0 then nullif(trim(coalesce(package_discount_input,'')),'') else null end,
      discount_reason=case when coalesce(package_discount_minor,0)>0 then trim(package_discount_reason) else null end,
      discount_authorized_by=case when coalesce(package_discount_minor,0)>0 then (select auth.uid()) else null end,
      line_total_minor=unit_price_minor-coalesce(package_discount_minor,0)
  where id=v_package_line_id;

  update public.product_acquisitions
  set activation_mode=case when package_start_mode='first_usage' then 'first_usage' else 'fixed_date' end,
      validity_days_snapshot=v_package.validity_days,
      starts_on=case when package_start_mode='first_usage' then null else v_core_start end,
      expires_on=case when package_start_mode='first_usage' then null else v_core_start+v_package.validity_days end,
      updated_at=now()
  where id=v_acquisition_id;

  if array_length(v_products,1)>1 then
    select sl.id,se.id into v_enrollment_line_id,v_enrollment_id
    from public.sale_lines sl
    join public.student_enrollments se on se.source_sale_line_id=sl.id
    where sl.sale_id=v_sale_id and sl.product_template_id=v_enrollment_product.id
    limit 1;

    if v_enrollment_line_id is null or v_enrollment_id is null then raise exception 'enrollment_creation_missing'; end if;

    if enrollment_resolution in ('promotion','exception') then
      update public.sale_lines
      set discount_minor=unit_price_minor,discount_kind=enrollment_resolution,discount_input='100%',
          discount_reason=trim(enrollment_reason),discount_authorized_by=(select auth.uid()),line_total_minor=0
      where id=v_enrollment_line_id;
    end if;

    update public.student_enrollments
    set starts_on=enrollment_effective_on,
        expires_on=case when v_enrollment_product.validity_days is null then null else enrollment_effective_on+v_enrollment_product.validity_days end,
        resolution_type=enrollment_resolution,
        resolution_reason=case when enrollment_resolution in ('promotion','exception') then trim(enrollment_reason) else null end,
        resolved_by=(select auth.uid()),updated_at=now()
    where id=v_enrollment_id;
  end if;

  select coalesce(sum(sl.line_total_minor),0)::integer into v_total
  from public.sale_lines sl where sl.sale_id=v_sale_id;

  if v_paid>v_total then raise exception 'payment_exceeds_balance'; end if;
  if v_paid>0 then
    if nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;
    if payment_effective_on is null then raise exception 'payment_effective_date_required'; end if;
    if payment_effective_on>v_today then raise exception 'payment_effective_date_future'; end if;
  end if;

  if v_enrollment_id is not null and enrollment_resolution='paid'
     and v_paid<v_enrollment_product.price_minor then
    raise exception 'enrollment_payment_required';
  end if;

  v_balance := greatest(v_total-v_paid,0);

  if v_balance>0 and payment_due_on is null
     and nullif(trim(coalesce(create_student_onboarding_sale.collection_note,'')),'') is null then
    raise exception 'payment_followup_required';
  end if;

  if payment_due_on is not null and payment_due_on<v_today then raise exception 'payment_due_date_past'; end if;

  if coalesce(allow_pending_access,false) and v_paid=0 and v_total>0
     and nullif(trim(coalesce(pending_access_reason,'')),'') is null then
    raise exception 'pending_access_reason_required';
  end if;

  v_access_blocked := v_total>0 and v_paid=0 and not coalesce(allow_pending_access,false);

  update public.sales
  set total_minor=v_total,idempotency_key=target_idempotency_key,
      payment_due_on=case when v_balance>0 then create_student_onboarding_sale.payment_due_on else null end,
      collection_note=case when v_balance>0 then nullif(trim(coalesce(create_student_onboarding_sale.collection_note,'')),'') else null end,
      pending_access_exception=(v_total>0 and v_paid=0 and coalesce(allow_pending_access,false)),
      pending_access_exception_by=case when v_total>0 and v_paid=0 and coalesce(allow_pending_access,false) then (select auth.uid()) else null end,
      pending_access_exception_reason=case when v_total>0 and v_paid=0 and coalesce(allow_pending_access,false) then trim(pending_access_reason) else null end,
      updated_at=now()
  where id=v_sale_id;

  update public.product_acquisitions
  set access_blocked=v_access_blocked,updated_at=now()
  where id=v_acquisition_id;

  if v_prior>0 then
    select coalesce(sum(quantity),0)::integer into v_current_balance
    from public.credit_ledger where acquisition_id=v_acquisition_id;
    if v_prior>v_current_balance then raise exception 'prior_credits_exceed_available'; end if;

    insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by)
    values(v_student.studio_id,v_acquisition_id,'adjustment',-v_prior,
      'Consumos previos al alta: ' || left(trim(prior_credits_reason),450),(select auth.uid()));
  end if;

  if v_paid>0 then
    insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,effective_on,created_by)
    values(v_student.studio_id,v_sale_id,'payment',v_paid,trim(payment_method),
      nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),
      payment_effective_on,(select auth.uid()));
  end if;

  return jsonb_build_object(
    'ok',true,'replayed',false,'sale_id',v_sale_id,'total_minor',v_total,'paid_minor',v_paid,
    'balance_minor',v_balance,'access_blocked',v_access_blocked,'activation_mode',package_start_mode
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_student_onboarding_sale_v2(target_student_id uuid, target_package_product_id uuid, target_enrollment_product_id uuid, target_idempotency_key uuid, package_start_mode text, package_starts_on date, package_discount_minor integer, package_discount_kind text, package_discount_input text, package_discount_reason text, enrollment_resolution text, enrollment_effective_on date, enrollment_reason text, initial_payment_minor integer, payment_method text, payment_effective_on date, payment_reference text, payment_notes text, payment_due_on date, collection_note text, allow_pending_access boolean, pending_access_reason text, prior_credits_used integer, prior_credits_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_package public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_enrollment_product public.product_templates%rowtype;
  v_has_policy boolean := false;
  v_has_current_enrollment boolean := false;
  v_products uuid[];
  v_core jsonb;
  v_sale_id uuid;
  v_existing_sale public.sales%rowtype;
  v_package_line_id uuid;
  v_acquisition_id uuid;
  v_enrollment_line_id uuid;
  v_enrollment_id uuid;
  v_timezone text;
  v_today date;
  v_core_start date;
  v_total integer := 0;
  v_paid integer := greatest(coalesce(initial_payment_minor,0),0);
  v_balance integer := 0;
  v_access_blocked boolean := false;
  v_prior integer := greatest(coalesce(prior_credits_used,0),0);
  v_current_balance integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_idempotency_key is null then raise exception 'idempotency_key_required'; end if;

  select * into v_student
  from public.students
  where id=target_student_id
  for update;

  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then raise exception 'student_not_operable'; end if;
  if not private.has_capability(v_student.studio_id,'sales.write') then raise exception 'forbidden'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_idempotency_key::text,0)
  );

  select * into v_existing_sale
  from public.sales
  where studio_id=v_student.studio_id
    and idempotency_key=target_idempotency_key
  limit 1;

  if found then
    select coalesce(sum(case when p.kind='payment' then p.amount_minor else -p.amount_minor end),0)::integer
    into v_paid
    from public.payments p
    where p.sale_id=v_existing_sale.id;

    return jsonb_build_object(
      'ok',true,'replayed',true,'sale_id',v_existing_sale.id,
      'total_minor',v_existing_sale.total_minor,'paid_minor',greatest(v_paid,0),
      'balance_minor',greatest(v_existing_sale.total_minor-v_paid,0)
    );
  end if;

  select * into v_package
  from public.product_templates
  where id=target_package_product_id
    and studio_id=v_student.studio_id
    and active=true
    and product_type='package';

  if not found then raise exception 'package_not_available'; end if;
  if v_package.validity_days is null then raise exception 'product_validity_missing'; end if;

  if package_start_mode not in ('today','specific','first_usage') then
    raise exception 'package_start_mode_invalid';
  end if;

  select timezone into v_timezone from public.studios where id=v_student.studio_id;
  v_today := (now() at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  if package_start_mode='specific' then
    if package_starts_on is null then raise exception 'package_start_date_required'; end if;
    v_core_start := package_starts_on;
  else
    v_core_start := v_today;
  end if;

  if coalesce(package_discount_minor,0)<0 or package_discount_minor>v_package.price_minor then
    raise exception 'discount_invalid';
  end if;

  if coalesce(package_discount_minor,0)>0 then
    if package_discount_kind not in ('percentage','amount','courtesy') then raise exception 'discount_kind_invalid'; end if;
    if nullif(trim(coalesce(package_discount_reason,'')),'') is null then raise exception 'discount_reason_required'; end if;
  elsif package_discount_kind is not null then
    raise exception 'discount_invalid';
  end if;

  if v_prior>0 then
    if v_package.unlimited then raise exception 'prior_credits_unavailable_for_unlimited'; end if;
    if v_prior>coalesce(v_package.credit_limit,0) then raise exception 'prior_credits_exceed_package'; end if;
    if nullif(trim(coalesce(prior_credits_reason,'')),'') is null then raise exception 'prior_credits_reason_required'; end if;
  end if;

  select * into v_policy from public.enrollment_policies where studio_id=v_student.studio_id;
  v_has_policy := found;

  if v_has_policy and v_policy.enabled and v_policy.required_for_booking then
    select exists(
      select 1
      from public.student_enrollments se
      where se.studio_id=v_student.studio_id and se.student_id=v_student.id and se.status='active'
        and se.starts_on<=v_today and (se.expires_on is null or se.expires_on>=v_today)
    ) into v_has_current_enrollment;

    if v_has_current_enrollment then
      if enrollment_resolution not in ('already_active','not_required') then raise exception 'enrollment_already_active'; end if;
    else
      if enrollment_resolution not in ('paid','promotion','exception') then raise exception 'enrollment_resolution_required'; end if;
      if coalesce(target_enrollment_product_id,v_policy.enrollment_product_template_id) is null then raise exception 'enrollment_product_not_configured'; end if;

      select * into v_enrollment_product
      from public.product_templates
      where id=coalesce(target_enrollment_product_id,v_policy.enrollment_product_template_id)
        and studio_id=v_student.studio_id and active=true and product_type='enrollment';

      if not found then raise exception 'enrollment_product_not_configured'; end if;
      if enrollment_effective_on is null then raise exception 'enrollment_effective_date_required'; end if;
      if enrollment_effective_on>v_today then raise exception 'enrollment_effective_date_future'; end if;

      if enrollment_resolution in ('promotion','exception')
         and nullif(trim(coalesce(enrollment_reason,'')),'') is null then
        raise exception 'enrollment_reason_required';
      end if;
    end if;
  else
    if enrollment_resolution not in ('not_required','already_active') then raise exception 'enrollment_not_required'; end if;
  end if;

  v_products := array[v_package.id];
  if v_has_policy and v_policy.enabled and v_policy.required_for_booking
     and not v_has_current_enrollment
     and enrollment_resolution in ('paid','promotion','exception') then
    v_products := array_append(v_products,v_enrollment_product.id);
  end if;

  v_core := private.create_manual_sale_core(v_student.id,v_products,0,null,null,null,v_core_start);
  v_sale_id := (v_core->>'sale_id')::uuid;

  select sl.id,pa.id into v_package_line_id,v_acquisition_id
  from public.sale_lines sl
  join public.product_acquisitions pa on pa.sale_line_id=sl.id
  where sl.sale_id=v_sale_id and sl.product_template_id=v_package.id
  limit 1;

  if v_package_line_id is null or v_acquisition_id is null then raise exception 'package_acquisition_missing'; end if;

  update public.sale_lines
  set discount_minor=coalesce(package_discount_minor,0),
      discount_kind=case when coalesce(package_discount_minor,0)>0 then package_discount_kind else null end,
      discount_input=case when coalesce(package_discount_minor,0)>0 then nullif(trim(coalesce(package_discount_input,'')),'') else null end,
      discount_reason=case when coalesce(package_discount_minor,0)>0 then trim(package_discount_reason) else null end,
      discount_authorized_by=case when coalesce(package_discount_minor,0)>0 then (select auth.uid()) else null end,
      line_total_minor=unit_price_minor-coalesce(package_discount_minor,0)
  where id=v_package_line_id;

  update public.product_acquisitions
  set activation_mode=case when package_start_mode='first_usage' then 'first_usage' else 'fixed_date' end,
      validity_days_snapshot=v_package.validity_days,
      starts_on=case when package_start_mode='first_usage' then null else v_core_start end,
      expires_on=case when package_start_mode='first_usage' then null else v_core_start+v_package.validity_days end,
      updated_at=now()
  where id=v_acquisition_id;

  if array_length(v_products,1)>1 then
    select sl.id,se.id into v_enrollment_line_id,v_enrollment_id
    from public.sale_lines sl
    join public.student_enrollments se on se.source_sale_line_id=sl.id
    where sl.sale_id=v_sale_id and sl.product_template_id=v_enrollment_product.id
    limit 1;

    if v_enrollment_line_id is null or v_enrollment_id is null then raise exception 'enrollment_creation_missing'; end if;

    if enrollment_resolution in ('promotion','exception') then
      update public.sale_lines
      set discount_minor=unit_price_minor,discount_kind=enrollment_resolution,discount_input='100%',
          discount_reason=trim(enrollment_reason),discount_authorized_by=(select auth.uid()),line_total_minor=0
      where id=v_enrollment_line_id;
    end if;

    update public.student_enrollments
    set starts_on=enrollment_effective_on,
        expires_on=case when v_enrollment_product.validity_days is null then null else enrollment_effective_on+v_enrollment_product.validity_days end,
        resolution_type=enrollment_resolution,
        resolution_reason=case when enrollment_resolution in ('promotion','exception') then trim(enrollment_reason) else null end,
        resolved_by=(select auth.uid()),updated_at=now()
    where id=v_enrollment_id;
  end if;

  select coalesce(sum(sl.line_total_minor),0)::integer into v_total
  from public.sale_lines sl where sl.sale_id=v_sale_id;

  if v_paid>v_total then raise exception 'payment_exceeds_balance'; end if;
  if v_paid>0 then
    if nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;
    if payment_effective_on is null then raise exception 'payment_effective_date_required'; end if;
    if payment_effective_on>v_today then raise exception 'payment_effective_date_future'; end if;
  end if;

  if v_enrollment_id is not null and enrollment_resolution='paid'
     and v_paid<v_enrollment_product.price_minor then
    raise exception 'enrollment_payment_required';
  end if;

  v_balance := greatest(v_total-v_paid,0);

  if v_balance>0 and payment_due_on is null
     and nullif(trim(coalesce(create_student_onboarding_sale_v2.collection_note,'')),'') is null then
    raise exception 'payment_followup_required';
  end if;

  if payment_due_on is not null and payment_due_on<v_today then raise exception 'payment_due_date_past'; end if;

  if coalesce(allow_pending_access,false) and v_paid=0 and v_total>0
     and nullif(trim(coalesce(pending_access_reason,'')),'') is null then
    raise exception 'pending_access_reason_required';
  end if;

  v_access_blocked := v_total>0 and v_paid=0 and not coalesce(allow_pending_access,false);

  update public.sales
  set total_minor=v_total,idempotency_key=target_idempotency_key,
      payment_due_on=case when v_balance>0 then create_student_onboarding_sale_v2.payment_due_on else null end,
      collection_note=case when v_balance>0 then nullif(trim(coalesce(create_student_onboarding_sale_v2.collection_note,'')),'') else null end,
      pending_access_exception=(v_total>0 and v_paid=0 and coalesce(allow_pending_access,false)),
      pending_access_exception_by=case when v_total>0 and v_paid=0 and coalesce(allow_pending_access,false) then (select auth.uid()) else null end,
      pending_access_exception_reason=case when v_total>0 and v_paid=0 and coalesce(allow_pending_access,false) then trim(pending_access_reason) else null end,
      updated_at=now()
  where id=v_sale_id;

  update public.product_acquisitions
  set access_blocked=v_access_blocked,updated_at=now()
  where id=v_acquisition_id;

  if v_prior>0 then
    select coalesce(sum(quantity),0)::integer into v_current_balance
    from public.credit_ledger where acquisition_id=v_acquisition_id;
    if v_prior>v_current_balance then raise exception 'prior_credits_exceed_available'; end if;

    insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by)
    values(v_student.studio_id,v_acquisition_id,'adjustment',-v_prior,
      'Consumos previos al alta: ' || left(trim(prior_credits_reason),450),(select auth.uid()));
  end if;

  if v_paid>0 then
    insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,effective_on,created_by)
    values(v_student.studio_id,v_sale_id,'payment',v_paid,trim(payment_method),
      nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),
      payment_effective_on,(select auth.uid()));
  end if;

  return jsonb_build_object(
    'ok',true,'replayed',false,'sale_id',v_sale_id,'total_minor',v_total,'paid_minor',v_paid,
    'balance_minor',v_balance,'access_blocked',v_access_blocked,'activation_mode',package_start_mode
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.booking_eligibility(target_session_id uuid, target_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_booked_count integer;
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
  v_has_required_enrollment boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
  v_is_staff boolean;
begin
  select * into v_session from public.class_sessions where id=target_session_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','session_not_found'); end if;
  select * into v_student from public.students where id=target_student_id and studio_id=v_session.studio_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','student_not_found'); end if;

  v_is_staff := private.has_capability(v_session.studio_id,'schedule.write');
  if not v_is_staff and not (v_student.user_id=(select auth.uid()) and private.has_capability(v_session.studio_id,'student.booking.self')) then
    raise exception 'forbidden';
  end if;

  if v_student.lifecycle_status<>'active' or not v_student.active then return jsonb_build_object('eligible',false,'reason_code','student_not_operable'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then return jsonb_build_object('eligible',false,'reason_code','session_not_bookable'); end if;
  if exists(select 1 from public.reservations r where r.session_id=target_session_id and r.student_id=target_student_id and r.status in ('reserved','attended')) then
    return jsonb_build_object('eligible',false,'reason_code','already_reserved');
  end if;

  select count(*) into v_booked_count from public.reservations r where r.session_id=target_session_id and r.status in ('reserved','attended');
  if v_booked_count>=v_session.capacity then return jsonb_build_object('eligible',false,'reason_code','session_full'); end if;

  select ct.discipline_id,greatest(coalesce(ct.credit_cost,1),1) into v_discipline_id,v_credit_cost
  from public.class_templates ct where ct.id=v_session.template_id;
  select timezone into v_timezone from public.studios where id=v_session.studio_id;
  v_class_date := (v_session.starts_at at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  select * into v_policy from public.enrollment_policies where studio_id=v_session.studio_id;
  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists(select 1 from public.student_enrollments se
      where se.studio_id=v_session.studio_id and se.student_id=target_student_id and se.status='active'
        and se.starts_on<=v_class_date and (se.expires_on is null or se.expires_on>=v_class_date)
    ) into v_has_required_enrollment;
    if not v_has_required_enrollment then return jsonb_build_object('eligible',false,'reason_code','enrollment_required'); end if;
  end if;

  select exists(select 1 from public.product_acquisitions pa
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
  ) into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists(select 1 from public.product_acquisitions pa
      where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id
        and pa.status='active' and pa.access_blocked
    ) into v_has_blocked_acquisition;
    if v_has_blocked_acquisition then return jsonb_build_object('eligible',false,'reason_code','payment_pending'); end if;
    return jsonb_build_object('eligible',false,'reason_code','no_active_product');
  end if;

  select exists(select 1 from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
      and ptd.discipline_id=v_discipline_id
  ) into v_has_discipline_acquisition;
  if not v_has_discipline_acquisition then return jsonb_build_object('eligible',false,'reason_code','outside_product'); end if;

  for v_acquisition in
    select pa.id,pa.unlimited,pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id=pa.product_template_id and ptd.studio_id=pa.studio_id
    where pa.studio_id=v_session.studio_id and pa.student_id=target_student_id and pa.status='active'
      and not pa.access_blocked
      and ((pa.activation_mode='first_usage' and pa.starts_on is null)
        or (pa.starts_on<=v_class_date and pa.expires_on>=v_class_date))
      and ptd.discipline_id=v_discipline_id
    order by pa.unlimited desc,coalesce(pa.expires_on,'infinity'::date) asc,pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',true,'available_credits',null,'credit_cost',v_credit_cost);
    end if;
    select coalesce(sum(cl.quantity),0)::integer into v_balance from public.credit_ledger cl where cl.acquisition_id=v_acquisition.id;
    if v_balance>=v_credit_cost then
      return jsonb_build_object('eligible',true,'reason_code',null,'acquisition_id',v_acquisition.id,'unlimited',false,'available_credits',v_balance,'credit_cost',v_credit_cost);
    end if;
  end loop;

  return jsonb_build_object('eligible',false,'reason_code','no_credits','credit_cost',v_credit_cost);
end;
$function$
;


create or replace function public.cancel_reservation(target_reservation_id uuid, target_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer;
  v_cutoff timestamptz;
  v_new_status public.reservation_status;
  v_is_staff boolean;
begin
  select * into v_reservation from public.reservations where id=target_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  select * into v_session from public.class_sessions where id=v_reservation.session_id;
  select * into v_student from public.students where id=v_reservation.student_id;
  v_credit_cost := greatest(coalesce(v_reservation.credits_held,1),1);

  v_is_staff := private.has_capability(v_reservation.studio_id,'schedule.write');
  if not v_is_staff and not (
    v_student.user_id=(select auth.uid())
    and private.has_capability(v_reservation.studio_id,'student.booking.self')
  ) then
    raise exception 'forbidden';
  end if;

  if v_reservation.status<>'reserved' then
    return jsonb_build_object('ok',false,'reason_code','reservation_not_cancellable');
  end if;

  v_cutoff := v_session.starts_at - interval '8 hours';
  v_new_status := case when now()<=v_cutoff then 'cancelled_on_time' else 'cancelled_late' end;

  update public.reservations
  set status=v_new_status,
      cancelled_at=now(),
      cancellation_reason=nullif(trim(target_reason),''),
      cancelled_by=(select auth.uid()),
      updated_at=now()
  where id=v_reservation.id;

  if v_reservation.acquisition_id is not null then
    select * into v_acquisition
    from public.product_acquisitions
    where id=v_reservation.acquisition_id
    for update;

    if found and not v_acquisition.unlimited then
      insert into public.credit_ledger(
        studio_id,acquisition_id,movement_type,quantity,reservation_id,note,created_by
      ) values (
        v_reservation.studio_id,v_reservation.acquisition_id,'release',v_credit_cost,
        v_reservation.id,
        case when v_new_status='cancelled_on_time'
          then format('%s crédito(s) devueltos por cancelación a tiempo',v_credit_cost)
          else format('Cierre del hold de %s crédito(s) por cancelación tardía',v_credit_cost)
        end,
        (select auth.uid())
      ) on conflict (reservation_id,movement_type) do nothing;

      if v_new_status='cancelled_late' then
        insert into public.credit_ledger(
          studio_id,acquisition_id,movement_type,quantity,reservation_id,note,created_by
        ) values (
          v_reservation.studio_id,v_reservation.acquisition_id,'consume',-v_credit_cost,
          v_reservation.id,format('%s crédito(s) consumidos por cancelación tardía',v_credit_cost),
          (select auth.uid())
        ) on conflict (reservation_id,movement_type) do nothing;
      end if;
    end if;

    if v_new_status='cancelled_late' then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end if;

  return jsonb_build_object('ok',true,'status',v_new_status::text,'credit_cost',v_credit_cost);
end;
$$;



create or replace function public.finalize_attendance(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_attended integer := 0;
  v_no_show integer := 0;
begin
  select * into v_session from public.class_sessions where id=target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;

  if not private.has_capability(v_session.studio_id,'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id,v_session.id) then
    raise exception 'forbidden';
  end if;

  if v_session.status='cancelled' then raise exception 'session_cancelled'; end if;
  if v_session.status='completed' then return jsonb_build_object('ok',true,'already_finalized',true); end if;

  update public.reservations set status='no_show',updated_at=now()
  where session_id=target_session_id and status='reserved';

  for v_reservation in
    select r.id,r.studio_id,r.acquisition_id,r.status,r.credits_held,
      pa.unlimited,pa.activation_mode,pa.starts_on,pa.validity_days_snapshot,pa.access_blocked
    from public.reservations r
    left join public.product_acquisitions pa on pa.id=r.acquisition_id
    where r.session_id=target_session_id and r.status in ('attended','no_show')
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held,1),1);

    if v_reservation.status='attended' then
      v_attended := v_attended+1;
    else
      v_no_show := v_no_show+1;
    end if;

    if v_reservation.acquisition_id is not null and not coalesce(v_reservation.unlimited,false) then
      if exists(
        select 1 from public.credit_ledger cl
        where cl.reservation_id=v_reservation.id and cl.movement_type='reserve'
      ) then
        insert into public.credit_ledger(
          studio_id,acquisition_id,movement_type,quantity,reservation_id,note,created_by
        ) values (
          v_reservation.studio_id,v_reservation.acquisition_id,'release',v_credit_cost,
          v_reservation.id,format('Cierre del hold de %s crédito(s) al finalizar asistencia',v_credit_cost),
          (select auth.uid())
        ) on conflict (reservation_id,movement_type) do nothing;
      end if;

      insert into public.credit_ledger(
        studio_id,acquisition_id,movement_type,quantity,reservation_id,note,created_by
      ) values (
        v_reservation.studio_id,v_reservation.acquisition_id,'consume',-v_credit_cost,
        v_reservation.id,
        case when v_reservation.status='attended'
          then format('%s crédito(s) consumidos por asistencia',v_credit_cost)
          else format('%s crédito(s) consumidos por no-show',v_credit_cost)
        end,
        (select auth.uid())
      ) on conflict (reservation_id,movement_type) do nothing;
    end if;

    if v_reservation.acquisition_id is not null then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end loop;

  update public.class_sessions set status='completed' where id=target_session_id;

  return jsonb_build_object(
    'ok',true,'already_finalized',false,'attended',v_attended,'no_show',v_no_show
  );
end;
$$;

