create or replace function private.create_manual_sale_core(
  target_student_id uuid,
  target_product_ids uuid[],
  initial_payment_minor integer,
  payment_method text,
  payment_reference text,
  payment_notes text,
  target_starts_on date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_has_policy boolean := false;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_enrollment_id uuid;
  v_studio_timezone text;
  v_sale_date date;
  v_acquisition_start_date date;
  v_folio text;
  v_total integer := 0;
  v_currency text := null;
  v_product_id uuid;
  v_distinct_count integer;
  v_paid integer := greatest(coalesce(initial_payment_minor, 0), 0);
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_product_ids is null or cardinality(target_product_ids) = 0 then
    raise exception 'products_required';
  end if;
  if coalesce(initial_payment_minor, 0) < 0 then raise exception 'payment_invalid'; end if;

  select * into v_student
  from public.students
  where id = target_student_id
  for update;

  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_operable';
  end if;
  if not private.has_capability(v_student.studio_id, 'sales.write') then
    raise exception 'forbidden';
  end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id = v_student.studio_id;
  v_has_policy := found;

  select count(distinct x), count(*)
  into v_distinct_count, v_total
  from unnest(target_product_ids) as x;

  if v_distinct_count <> v_total then raise exception 'duplicate_product_line'; end if;
  v_total := 0;

  foreach v_product_id in array target_product_ids loop
    select * into v_product
    from public.product_templates
    where id = v_product_id
      and studio_id = v_student.studio_id
      and active = true;

    if not found then raise exception 'product_not_available'; end if;

    if v_product.product_type = 'enrollment' and (
      not v_has_policy
      or not v_policy.enabled
      or v_policy.enrollment_product_template_id is distinct from v_product.id
    ) then
      raise exception 'enrollment_product_not_configured';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'currency_mismatch';
    end if;

    v_total := v_total + v_product.price_minor;
  end loop;

  if v_paid > v_total then raise exception 'payment_exceeds_balance'; end if;
  if v_paid > 0 and nullif(trim(coalesce(payment_method, '')), '') is null then
    raise exception 'payment_method_required';
  end if;

  select timezone into v_studio_timezone
  from public.studios
  where id = v_student.studio_id;

  v_sale_date := (now() at time zone coalesce(v_studio_timezone, 'America/Mexico_City'))::date;
  v_acquisition_start_date := coalesce(target_starts_on, v_sale_date);
  v_folio := 'V-' || to_char(v_sale_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_sale_id::text, '-', ''), 1, 12));

  insert into public.sales(
    id,
    studio_id,
    student_id,
    folio,
    currency,
    total_minor,
    created_by
  ) values (
    v_sale_id,
    v_student.studio_id,
    v_student.id,
    v_folio,
    coalesce(v_currency, 'MXN'),
    v_total,
    (select auth.uid())
  );

  foreach v_product_id in array target_product_ids loop
    v_acquisition_id := null;
    v_enrollment_id := null;

    select * into v_product
    from public.product_templates
    where id = v_product_id;

    insert into public.sale_lines(
      studio_id,
      sale_id,
      product_template_id,
      product_name,
      quantity,
      unit_price_minor,
      line_total_minor
    ) values (
      v_student.studio_id,
      v_sale_id,
      v_product.id,
      v_product.name,
      1,
      v_product.price_minor,
      v_product.price_minor
    )
    returning id into v_sale_line_id;

    if v_product.product_type = 'enrollment' then
      insert into public.student_enrollments(
        studio_id,
        student_id,
        status,
        starts_on,
        expires_on,
        source_sale_id,
        source_sale_line_id,
        created_by
      ) values (
        v_student.studio_id,
        v_student.id,
        'active',
        v_sale_date,
        v_sale_date + v_product.validity_days,
        v_sale_id,
        v_sale_line_id,
        (select auth.uid())
      )
      on conflict (source_sale_line_id) do nothing
      returning id into v_enrollment_id;
    else
      if v_product.validity_days is null then raise exception 'product_validity_missing'; end if;

      insert into public.product_acquisitions(
        studio_id,
        student_id,
        product_template_id,
        status,
        starts_on,
        expires_on,
        credit_limit,
        unlimited,
        sale_line_id
      ) values (
        v_student.studio_id,
        v_student.id,
        v_product.id,
        'active',
        v_acquisition_start_date,
        v_acquisition_start_date + v_product.validity_days,
        v_product.credit_limit,
        v_product.unlimited,
        v_sale_line_id
      )
      on conflict (sale_line_id) where sale_line_id is not null do nothing
      returning id into v_acquisition_id;

      if v_acquisition_id is null then
        select id into v_acquisition_id
        from public.product_acquisitions
        where sale_line_id = v_sale_line_id;
      end if;

      if not v_product.unlimited and coalesce(v_product.credit_limit, 0) > 0 then
        if not exists (
          select 1
          from public.credit_ledger
          where acquisition_id = v_acquisition_id
            and movement_type = 'grant'
        ) then
          insert into public.credit_ledger(
            studio_id,
            acquisition_id,
            movement_type,
            quantity,
            note,
            created_by
          ) values (
            v_student.studio_id,
            v_acquisition_id,
            'grant',
            v_product.credit_limit,
            'Venta ' || v_folio,
            (select auth.uid())
          );
        end if;
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.payments(
      studio_id,
      sale_id,
      kind,
      amount_minor,
      method,
      reference,
      notes,
      created_by
    ) values (
      v_student.studio_id,
      v_sale_id,
      'payment',
      v_paid,
      trim(payment_method),
      nullif(trim(coalesce(payment_reference, '')), ''),
      nullif(trim(coalesce(payment_notes, '')), ''),
      (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_id,
    'folio', v_folio,
    'total_minor', v_total,
    'paid_minor', v_paid,
    'balance_minor', v_total - v_paid,
    'acquisition_starts_on', v_acquisition_start_date
  );
end;
$$;

revoke all on function private.create_manual_sale_core(uuid, uuid[], integer, text, text, text, date)
  from public, anon, authenticated, service_role;

create or replace function public.create_manual_sale(
  target_student_id uuid,
  target_product_ids uuid[],
  initial_payment_minor integer default 0,
  payment_method text default null,
  payment_reference text default null,
  payment_notes text default null
)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select private.create_manual_sale_core(
    target_student_id,
    target_product_ids,
    initial_payment_minor,
    payment_method,
    payment_reference,
    payment_notes,
    null
  );
$$;

revoke all on function public.create_manual_sale(uuid, uuid[], integer, text, text, text)
  from public, anon;
grant execute on function public.create_manual_sale(uuid, uuid[], integer, text, text, text)
  to authenticated, service_role;

create or replace function public.create_manual_sale(
  target_student_id uuid,
  target_product_ids uuid[],
  initial_payment_minor integer,
  payment_method text,
  payment_reference text,
  payment_notes text,
  target_starts_on date
)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select private.create_manual_sale_core(
    target_student_id,
    target_product_ids,
    initial_payment_minor,
    payment_method,
    payment_reference,
    payment_notes,
    target_starts_on
  );
$$;

revoke all on function public.create_manual_sale(uuid, uuid[], integer, text, text, text, date)
  from public, anon;
grant execute on function public.create_manual_sale(uuid, uuid[], integer, text, text, text, date)
  to authenticated, service_role;
