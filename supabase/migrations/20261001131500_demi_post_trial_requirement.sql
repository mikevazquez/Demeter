create or replace function public.assistant_post_trial_requirement(
  target_studio_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_has_enrollment boolean := false;
  v_timezone text;
  v_today date;
  v_blockers jsonb := '[]'::jsonb;
  v_account_status text;
  v_must_change_password boolean;
begin
  if target_studio_id is null or target_student_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id
    and studio_id=target_studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','student_not_found');
  end if;

  select count(*)::integer into v_attended
  from public.reservations
  where studio_id=target_studio_id
    and student_id=target_student_id
    and status='attended';

  if v_attended=0 then
    return jsonb_build_object('ok',true,'post_trial',false,'attended_count',0);
  end if;

  select coalesce(timezone,'America/Mexico_City')
    into v_timezone
  from public.studios
  where id=target_studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_has_enrollment := private.student_has_active_enrollment(
    target_studio_id,
    target_student_id,
    v_today
  );

  select * into v_policy
  from public.enrollment_policies
  where studio_id=target_studio_id;

  if found and v_policy.enrollment_product_template_id is not null then
    select * into v_product
    from public.product_templates
    where id=v_policy.enrollment_product_template_id
      and studio_id=target_studio_id
      and active=true
      and product_type='enrollment'::public.product_type;
  end if;

  v_blockers := coalesce(
    private.student_booking_blockers(target_student_id,null),
    '[]'::jsonb
  );

  if v_student.user_id is not null then
    select ua.status::text,ua.must_change_password
      into v_account_status,v_must_change_password
    from public.user_accounts ua
    where ua.id=v_student.user_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'post_trial',true,
    'attended_count',v_attended,
    'enrollment_required',
      coalesce(v_policy.enabled,false)
      and coalesce(v_policy.required_for_booking,false)
      and not v_has_enrollment,
    'has_active_enrollment',v_has_enrollment,
    'enrollment_product',
      case when v_product.id is null then null else jsonb_build_object(
        'id',v_product.id,
        'name',v_product.name,
        'price_minor',v_product.price_minor,
        'currency',upper(v_product.currency),
        'online_purchasable',v_product.online_purchasable
      ) end,
    'booking_blockers',v_blockers,
    'documents_pending',
      exists(
        select 1
        from jsonb_array_elements(v_blockers) blocker(item)
        where item->>'action_kind' in ('documents','profile')
      ),
    'access_state',
      case
        when v_student.user_id is null then 'not_provisioned'
        when v_account_status='active' and coalesce(v_must_change_password,false) then 'activation_pending'
        when v_account_status='active' and coalesce(v_must_change_password,false)=false then 'active'
        else 'inconsistent'
      end
  );
end;
$function$;

revoke all on function public.assistant_post_trial_requirement(uuid,uuid) from public;
grant execute on function public.assistant_post_trial_requirement(uuid,uuid)
  to authenticated,service_role;
