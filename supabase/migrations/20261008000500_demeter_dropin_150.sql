-- Demeter: every regular class can be purchased as a $150 drop-in when the
-- student's package is unavailable, exhausted, or does not cover the class.
-- Demo/UAT templates keep their own test prices.

do $$
declare
  v_studio_id uuid;
  v_candidate record;
  v_product_id uuid;
begin
  select id
    into v_studio_id
  from public.studios
  where slug = 'demeter-fitness'
  limit 1;

  if v_studio_id is null then
    return;
  end if;

  update public.class_templates
  set drop_in_price_minor = 15000
  where studio_id = v_studio_id
    and active = true
    and name not ilike 'DEMO ·%';

  for v_candidate in
    select distinct
      ct.discipline_id,
      d.name as discipline_name
    from public.class_templates ct
    join public.disciplines d
      on d.id = ct.discipline_id
     and d.studio_id = ct.studio_id
    where ct.studio_id = v_studio_id
      and ct.active = true
      and ct.name not ilike 'DEMO ·%'
  loop
    v_product_id := null;

    select pt.id
      into v_product_id
    from public.product_templates pt
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pt.id
     and ptd.studio_id = pt.studio_id
    where pt.studio_id = v_studio_id
      and pt.product_type = 'single_class'::public.product_type
      and pt.active = true
      and pt.online_purchasable = true
      and pt.price_minor = 15000
      and coalesce(pt.credit_limit, 0) = 1
      and coalesce(pt.validity_days, 0) > 0
      and ptd.discipline_id = v_candidate.discipline_id
    order by pt.created_at asc
    limit 1;

    if v_product_id is null then
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
        v_studio_id,
        'Clase suelta · ' || v_candidate.discipline_name,
        '1 clase de ' || v_candidate.discipline_name,
        'single_class'::public.product_type,
        15000,
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
        v_studio_id,
        v_product_id,
        v_candidate.discipline_id
      )
      on conflict do nothing;
    end if;
  end loop;
end
$$;
