create or replace function private.reward_checkout_price(
  p_student_id uuid,
  p_product_template_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_regular integer;
  v_pct integer := 0;
  v_final integer;
  v_discount integer;
begin
  if p_student_id is null or p_product_template_id is null or p_as_of is null then
    raise exception 'reward_price_arguments_required';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;
  if not found then raise exception 'student_not_found'; end if;

  select * into v_product
  from public.product_templates
  where id = p_product_template_id
    and studio_id = v_student.studio_id;
  if not found then raise exception 'product_not_found'; end if;

  perform private.reward_status_sync_student(v_student.id, p_as_of);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id = m.studio_id
   and d.level_key = m.current_level_key
  where m.studio_id = v_student.studio_id
    and m.student_id = v_student.id;

  v_regular := v_product.price_minor;

  if v_level.id is not null
     and v_product.reward_discount_eligible
     and v_product.reward_discount_family is not null then
    if v_product.reward_discount_family = 'private_class' then
      v_pct := coalesce(v_level.private_discount_pct, 0);
    else
      v_pct := coalesce(v_level.event_discount_pct, 0);
    end if;
  end if;

  v_pct := greatest(0, least(v_pct, 100));
  v_final := greatest(
    1,
    round(v_regular::numeric * (100 - v_pct)::numeric / 100)::integer
  );
  v_discount := v_regular - v_final;

  return jsonb_build_object(
    'product_template_id', v_product.id,
    'eligible', v_level.id is not null
      and v_product.reward_discount_eligible
      and v_product.reward_discount_family is not null,
    'discount_family', v_product.reward_discount_family,
    'level_key', v_level.level_key,
    'level_title', coalesce(v_level.title, 'Sin medalla'),
    'medal_key', v_level.level_key,
    'medal_title', coalesce(v_level.title, 'Sin medalla'),
    'discount_pct', v_pct,
    'regular_amount_minor', v_regular,
    'discount_minor', v_discount,
    'final_amount_minor', v_final,
    'currency', upper(v_product.currency)
  );
end;
$function$;

revoke all on function private.reward_checkout_price(uuid, uuid, date)
from public, anon, authenticated, service_role;
