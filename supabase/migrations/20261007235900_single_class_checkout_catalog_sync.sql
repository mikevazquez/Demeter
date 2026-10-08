-- Keep the student single-class checkout catalog aligned with every active
-- class template that advertises a drop-in price.
--
-- The reserve UI treats drop_in_price_minor as a purchasable single class.
-- Checkout also requires an active online single_class product for the same
-- discipline and price. Seed any missing product/mapping so the CTA cannot
-- lead to single_class_product_not_available.

do $$
declare
  v_candidate record;
  v_product_id uuid;
  v_price_label text;
begin
  for v_candidate in
    select distinct
      ct.studio_id,
      ct.discipline_id,
      d.name as discipline_name,
      ct.drop_in_price_minor as price_minor
    from public.class_templates ct
    join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = ct.studio_id
    where ct.active = true
      and coalesce(ct.drop_in_price_minor, 0) > 0
  loop
    v_product_id := null;

    select pt.id
      into v_product_id
    from public.product_templates pt
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pt.id
     and ptd.studio_id = pt.studio_id
    where pt.studio_id = v_candidate.studio_id
      and pt.product_type = 'single_class'::public.product_type
      and pt.active = true
      and pt.online_purchasable = true
      and pt.price_minor = v_candidate.price_minor
      and coalesce(pt.credit_limit, 0) = 1
      and coalesce(pt.validity_days, 0) > 0
      and ptd.discipline_id = v_candidate.discipline_id
    order by pt.created_at asc
    limit 1;

    if v_product_id is null then
      v_price_label := to_char(
        v_candidate.price_minor / 100.0,
        'FM999999990.00'
      );

      insert into public.product_templates (
        studio_id,
        name,
        description,
        product_type,
        price_minor,
        currency,
        credit_limit,
        validity_days,
        unlimited,
        active,
        package_term,
        online_purchasable
      ) values (
        v_candidate.studio_id,
        'Clase suelta · ' || v_candidate.discipline_name || ' · $' || v_price_label,
        '1 clase de ' || v_candidate.discipline_name,
        'single_class'::public.product_type,
        v_candidate.price_minor,
        'MXN',
        1,
        30,
        false,
        true,
        null,
        true
      )
      returning id into v_product_id;

      insert into public.product_template_disciplines (
        studio_id,
        product_template_id,
        discipline_id
      ) values (
        v_candidate.studio_id,
        v_product_id,
        v_candidate.discipline_id
      )
      on conflict do nothing;
    end if;
  end loop;
end
$$;
