-- Activate Demeter's approved annual enrollment policy without removing
-- previously grandfathered historical-payment exceptions.

do $$
declare
  v_studio_id uuid;
  v_product_id uuid;
begin
  select id
    into v_studio_id
  from public.studios
  where slug = 'demeter-fitness'
  limit 1;

  if v_studio_id is null then
    raise exception 'demeter_studio_not_found';
  end if;

  select coalesce(
    (
      select ep.enrollment_product_template_id
      from public.enrollment_policies ep
      where ep.studio_id = v_studio_id
    ),
    (
      select pt.id
      from public.product_templates pt
      where pt.studio_id = v_studio_id
        and pt.product_type = 'enrollment'::public.product_type
        and pt.active = true
      order by pt.created_at asc
      limit 1
    )
  )
  into v_product_id;

  if v_product_id is null then
    raise exception 'enrollment_product_not_found';
  end if;

  update public.product_templates
  set name = 'Inscripción anual',
      price_minor = 20000,
      currency = 'MXN',
      validity_days = 365,
      active = true,
      online_purchasable = false,
      updated_at = now()
  where id = v_product_id
    and studio_id = v_studio_id;

  insert into public.enrollment_policies(
    studio_id,
    enabled,
    required_for_booking,
    required_for_package_purchase,
    required_for_single_class,
    single_class_grace_count,
    enrollment_product_template_id,
    rules
  )
  values(
    v_studio_id,
    true,
    true,
    true,
    true,
    0,
    v_product_id,
    '{}'::jsonb
  )
  on conflict(studio_id) do update
  set enabled = true,
      required_for_booking = true,
      required_for_package_purchase = true,
      required_for_single_class = true,
      single_class_grace_count = 0,
      enrollment_product_template_id = excluded.enrollment_product_template_id,
      updated_at = now();

  -- Deliberately do not mutate existing student_enrollments here.
  -- Prior historical-payment exceptions remain valid.
end
$$;
