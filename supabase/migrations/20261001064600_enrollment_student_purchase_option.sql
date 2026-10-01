-- Student-safe enrollment purchase option for the portal.
create or replace function public.student_enrollment_purchase_option()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_studio public.studios%rowtype;
  v_product public.product_templates%rowtype;
  v_today date;
  v_missing boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  if not private.has_capability(v_student.studio_id,'student.portal') then
    raise exception 'forbidden';
  end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;

  if not found or not v_policy.enabled then
    return jsonb_build_object(
      'enabled',false,
      'missing',false,
      'configured',false,
      'product',null
    );
  end if;

  select * into v_studio
  from public.studios
  where id=v_student.studio_id;

  v_today := (now() at time zone coalesce(v_studio.timezone,'America/Mexico_City'))::date;
  v_missing := not private.student_has_active_enrollment(
    v_student.studio_id,
    v_student.id,
    v_today
  );

  if v_policy.enrollment_product_template_id is not null then
    select * into v_product
    from public.product_templates
    where id=v_policy.enrollment_product_template_id
      and studio_id=v_student.studio_id
      and active=true
      and product_type='enrollment'::public.product_type;
  end if;

  return jsonb_build_object(
    'enabled',true,
    'missing',v_missing,
    'configured',found,
    'product',
      case when found then jsonb_build_object(
        'id',v_product.id,
        'name',v_product.name,
        'price_minor',v_product.price_minor,
        'currency',v_product.currency,
        'validity_days',v_product.validity_days
      ) else null end
  );
end;
$function$;

revoke all on function public.student_enrollment_purchase_option() from public,anon;
grant execute on function public.student_enrollment_purchase_option() to authenticated;
