-- NEB-01-15 · Plantillas de arranque: la consola aplica disciplinas, actividades y paquetes de una
-- plantilla (definida en lib/platform/starter-templates.ts). Solo crea lo que no existe con el mismo
-- nombre; los paquetes quedan INACTIVOS para que la dueña revise precios antes de vender. No crea clases.

create or replace function public.platform_apply_starter_template(p_studio uuid, p_template jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text;
  v_item jsonb;
  v_name text;
  v_discipline uuid;
  v_disciplines integer := 0;
  v_activities integer := 0;
  v_products integer := 0;
begin
  perform private.platform_require_admin();
  select coalesce(nullif(currency, ''), 'MXN') into v_currency from public.studios where id = p_studio;
  if not found then
    raise exception 'studio_not_found';
  end if;
  if jsonb_typeof(p_template) <> 'object'
     or coalesce(p_template->>'key', '') !~ '^[a-z_]{3,40}$'
     or jsonb_typeof(p_template->'disciplines') <> 'array'
     or jsonb_typeof(p_template->'activities') <> 'array'
     or jsonb_typeof(p_template->'products') <> 'array'
     or jsonb_array_length(p_template->'activities') > 40
     or jsonb_array_length(p_template->'products') > 40 then
    raise exception 'template_invalid';
  end if;

  for v_item in select value from jsonb_array_elements(p_template->'disciplines') loop
    v_name := btrim(v_item #>> '{}');
    if char_length(v_name) between 2 and 60 then
      insert into public.disciplines (studio_id, name) values (p_studio, v_name)
      on conflict (studio_id, name) do nothing;
      if found then v_disciplines := v_disciplines + 1; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_template->'activities') loop
    v_name := btrim(coalesce(v_item->>'name', ''));
    continue when char_length(v_name) < 2 or char_length(v_name) > 80;
    continue when exists (select 1 from public.class_templates ct where ct.studio_id = p_studio and lower(ct.name) = lower(v_name));
    select d.id into v_discipline from public.disciplines d
    where d.studio_id = p_studio and d.name = btrim(coalesce(v_item->>'discipline', '')) limit 1;
    insert into public.class_templates (studio_id, discipline_id, name, duration_minutes, capacity, color_hex,
      credit_cost, drop_in_price_minor)
    values (p_studio, v_discipline, v_name,
      least(greatest(coalesce((v_item->>'duration_minutes')::integer, 60), 15), 360),
      greatest(coalesce((v_item->>'capacity')::integer, 10), 1),
      case when coalesce(v_item->>'color_hex', '') ~ '^#[0-9A-Fa-f]{6}$' then v_item->>'color_hex' else '#FF0A8A' end,
      greatest(coalesce((v_item->>'credit_cost')::integer, 1), 1),
      greatest(coalesce((v_item->>'drop_in_price_minor')::integer, 0), 0));
    v_activities := v_activities + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_template->'products') loop
    v_name := btrim(coalesce(v_item->>'name', ''));
    continue when char_length(v_name) < 2 or char_length(v_name) > 120;
    continue when coalesce(v_item->>'product_type', '') not in ('package', 'membership', 'single_class', 'enrollment');
    insert into public.product_templates (studio_id, name, product_type, price_minor, currency, credit_limit,
      validity_days, unlimited, active, package_term)
    values (p_studio, v_name, (v_item->>'product_type')::public.product_type,
      greatest(coalesce((v_item->>'price_minor')::integer, 0), 0), v_currency,
      nullif((v_item->>'credit_limit'), '')::integer,
      nullif((v_item->>'validity_days'), '')::integer,
      coalesce((v_item->>'unlimited')::boolean, false),
      false,
      nullif(v_item->>'package_term', ''))
    on conflict (studio_id, name) do nothing;
    if found then v_products := v_products + 1; end if;
  end loop;

  perform private.platform_audit(p_studio, 'studio.template.applied', jsonb_build_object(
    'template', p_template->>'key', 'disciplines', v_disciplines, 'activities', v_activities, 'products', v_products));

  return jsonb_build_object('disciplines', v_disciplines, 'activities', v_activities, 'products', v_products);
end;
$$;
revoke all on function public.platform_apply_starter_template(uuid, jsonb) from public, anon;
grant execute on function public.platform_apply_starter_template(uuid, jsonb) to authenticated;
